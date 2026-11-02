"""Prove who you are, then set your password (M4b spec §7 rule 5). No admin step, no SMS, no email.

- Face proof (face employees): the employee types their code and does the gate's head-turn check
  on the phone. The face rules run the same way for EVERY code (so the retry hints tell nothing);
  then the code decides: only an active face employee with phone punching ON, an agreed consent
  and a template of the running model can pass, with a 1:1 score >= `face_match_threshold`.
- Card proof (QR workers): the worker scans their own valid ID card inside the plant fence.
Every "not you / not allowed" case gives ONE answer, PROOF_FAILED, and every pass or failure takes
at least 1 second, so neither the body nor the timing tells which case it was. A pass gives a
proof token (5 minutes, once). No face picture is kept, not even for a failed proof.
"""

import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NoReturn

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.antiproxy.context import DeviceIdentity, Outcome
from app.antiproxy.engine import OFFLINE_FACE_RULES, run_face_rules
from app.antiproxy.face_context import FaceFrame, FacePunchContext
from app.antiproxy.facts_at_time import employee_plant_on
from app.antiproxy.rules.face_challenge import nonce_hash
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.password_gate import password_check_slot
from app.core.time import to_ist, utc_now
from app.face.engine import FaceEngine
from app.face.matcher import cosine
from app.face.models import FaceModels
from app.modules.audit.service import Actor, record_audit
from app.modules.auth.passwords import hash_password
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.employees.rules import clean_code
from app.modules.face.consent_service import active_consent
from app.modules.face.engine_provider import face_key, ready_model_id, run_face_job
from app.modules.face.enrolment_service import open_template
from app.modules.face.template_service import active_template
from app.modules.kiosks.location_check import Location, check_location
from app.modules.phone.access import phone_punch_on
from app.modules.phone.access_service import account_row
from app.modules.phone.dependencies import phone_punch_off
from app.modules.phone.models import PhoneProof, ProofKind, SessionRevokeKind, SignInMethod
from app.modules.phone.passwords import check_employee_password
from app.modules.phone.rate_limits import (
    EVERYONE,
    card_serial_failure_limiter,
    face_proof_code_limiter,
    failed_proof_limiter,
    password_set_limiter,
    proof_ip_limiter,
)
from app.modules.phone.schemas import CardProofRequest, FaceProofRequest
from app.modules.phone.sessions import end_all, lock_employee
from app.modules.phone.sign_in_service import SignedIn, finish_sign_in
from app.modules.punches.face_service import (
    capture_rules,
    choose_challenge,
    decode_frame,
    load_face_limits,
)
from app.modules.punches.offline_face_service import EMPTY_GALLERY
from app.modules.punches.schemas import CaptureRules
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.payload import ParsedPayload, parse_payload, signature_is_valid
from app.modules.settings.service import get_float_setting, get_int_setting

PROOF_TOKEN_LIFE = timedelta(minutes=5)
MIN_ANSWER_SECONDS = 1.0
# Face problems where trying again can help; the same answer for every typed code.
RETRY_HINTS = frozenset(
    {
        "NO_FACE",
        "MULTIPLE_FACES",
        "FACE_TOO_SMALL",
        "FACE_QUALITY_LOW",
        "LIVENESS_FAILED",
        "CHALLENGE_EXPIRED",
        "CHALLENGE_INVALID",
        "FRAMES_INVALID",
    }
)
# What the phone says when the card was fine but the place is not (the gate texts talk about a
# device, so the phone has its own English texts; the screens use errors.<CODE>).
LOCATION_MESSAGES = {
    "LOCATION_REQUIRED": "We could not read your location. Please try again.",
    "GPS_ACCURACY_TOO_LOW": "Your location is not exact enough. Please try again.",
    "GEOFENCE_NOT_SET": "Your plant has no geofence yet. Please visit the plant office.",
    "OUTSIDE_GEOFENCE": "You are not at the plant. Please visit the plant office.",
}
# The face rules need a plant and a device in their context, but the proof rules never read them
# (no challenge rule, no gallery, no location): these stand-ins only fill the fields.
NO_PLANT = uuid.UUID(int=0)


@dataclass(frozen=True)
class FaceProofChallenge:
    proof_id: uuid.UUID
    challenge_nonce: str
    challenge: str
    expires_at: datetime
    server_time: datetime
    capture: CaptureRules


@dataclass(frozen=True)
class PassedProof:
    token: str
    expires_at: datetime
    employee: Employee


# --- Face proof -----------------------------------------------------------------------------------


def issue_face_challenge(
    session: Session, *, employee_code: str, ip: str, engine: FaceEngine
) -> FaceProofChallenge:
    """A challenge for ANY well-formed code: no hint whether it exists (rule 5.1)."""
    _check_proof_limits(ip)
    face_key()  # FACE_NOT_CONFIGURED before the person starts
    ready_model_id(engine)  # FACE_SERVICE_UNAVAILABLE while the models load
    now = utc_now()
    nonce = secrets.token_urlsafe(16)
    proof = PhoneProof(
        kind=ProofKind.FACE.value,
        claimed_code=clean_code(employee_code)[:12],
        challenge=choose_challenge(session),
        nonce_sha256=nonce_hash(nonce),
        issued_at=now,
        expires_at=now + timedelta(seconds=get_int_setting(session, "face_challenge_seconds")),
        ip=_ip_or_none(ip),
    )
    session.add(proof)
    session.commit()
    return FaceProofChallenge(
        proof.id, nonce, proof.challenge or "", proof.expires_at, now, capture_rules(session)
    )


def prove_face(
    session: Session, request: FaceProofRequest, *, ip: str, engine: FaceEngine
) -> PassedProof:
    started = time.monotonic()
    _check_proof_limits(ip)
    now = utc_now()  # before waiting for the face worker: the challenge expiry is judged on it
    key = face_key()
    model_id = ready_model_id(engine)
    proof = _use_face_challenge(session, request, now)
    code = proof.claimed_code or ""
    if not face_proof_code_limiter.allow(code):
        raise ApiError("TOO_MANY_REQUESTS", "Too many checks for this code. Try again later.", 429)

    candidate, template = _face_candidate(session, code, model_id, key)
    face_limits = load_face_limits(session)
    frames = [FaceFrame(role=frame.role, jpeg=decode_frame(frame.jpeg)) for frame in request.frames]

    def job(models: FaceModels) -> tuple[str | None, np.ndarray | None]:
        context = FacePunchContext(
            session=session,
            plant_id=NO_PLANT,
            device_identity=DeviceIdentity.of_phone_session(proof.id),
            now=now,
            limits=face_limits,
            models=models,
            gallery=EMPTY_GALLERY,
            challenge_nonce="",
            frames=frames,
        )
        context.challenge = proof.challenge  # checked and used above
        result = run_face_rules(context, OFFLINE_FACE_RULES)
        refusal = result.reason_code if result.outcome is Outcome.REJECT else None
        return refusal, context.embedding

    refusal, embedding = run_face_job(engine, job)
    if refusal in RETRY_HINTS:
        raise _retry_hint(refusal or "FRAMES_INVALID")
    matched = (
        refusal is None
        and candidate is not None
        and template is not None
        and embedding is not None
        and cosine(embedding, template) >= get_float_setting(session, "face_match_threshold")
    )
    if not matched or candidate is None:
        # This failure used the face worker, so it counts towards the company-wide limit.
        _fail(session, proof, ip, started, count_for_everyone=True)
    return _pass(session, proof, candidate, now, started)


def _use_face_challenge(session: Session, request: FaceProofRequest, now: datetime) -> PhoneProof:
    """The challenge must be this proof's, unused and fresh. It is used up even when a later
    step refuses (one try per challenge), so it is saved at once."""
    proof = session.scalar(
        select(PhoneProof)
        .where(PhoneProof.id == request.proof_id, PhoneProof.kind == ProofKind.FACE.value)
        .with_for_update()
    )
    if (
        proof is None
        or proof.used_at is not None
        or proof.nonce_sha256 != nonce_hash(request.challenge_nonce)
    ):
        raise _retry_hint("CHALLENGE_INVALID")
    proof.used_at = now
    session.commit()
    if proof.expires_at < now:
        raise _retry_hint("CHALLENGE_EXPIRED")
    return proof


def _face_candidate(
    session: Session, code: str, model_id: str, key: bytes
) -> tuple[Employee | None, np.ndarray | None]:
    """The only person who can pass for this code, with their opened template, or (None, None):
    unknown code, card worker, left, phone OFF, no consent or no template all look the same."""
    employee = session.scalar(select(Employee).where(Employee.employee_code == clean_code(code)))
    if (
        employee is None
        or employee.status != EmployeeStatus.ACTIVE.value
        or employee.punch_method != PunchMethod.FACE.value
        or not phone_punch_on(session, employee.id)
        or active_consent(session, employee.id) is None
    ):
        return None, None
    template = active_template(session, employee.id)
    if template is None or template.model_id != model_id:
        return None, None
    return employee, open_template(template, key)


def _retry_hint(code: str) -> ApiError:
    return ApiError(
        code, "The face check did not work. Please try again.", 422, {"retry_allowed": True}
    )


# --- Card proof -----------------------------------------------------------------------------------


def prove_card(session: Session, request: CardProofRequest, *, ip: str) -> PassedProof:
    started = time.monotonic()
    _check_proof_limits(ip)
    now = utc_now()
    proof = PhoneProof(
        kind=ProofKind.CARD.value,
        issued_at=now,
        expires_at=now + PROOF_TOKEN_LIFE,
        used_at=now,
        ip=_ip_or_none(ip),
    )
    session.add(proof)
    parsed = parse_payload(request.qr_payload)
    if parsed is None or not signature_is_valid(get_settings(), parsed):
        # Not a real card: cheap to send, so it must not use up anyone else's allowance.
        _fail(session, proof, ip, started)
    if card_serial_failure_limiter.blocked(parsed.serial):
        raise ApiError("TOO_MANY_REQUESTS", "Too many checks for this card. Try again later.", 429)
    employee = _card_owner(session, parsed, now)
    if employee is None:
        # A genuinely signed card that is refused (revoked, expired, phone off...): limit per card.
        card_serial_failure_limiter.record(parsed.serial)
        _fail(session, proof, ip, started)
    _check_place(session, employee, request, now)
    return _pass(session, proof, employee, now, started)


def _card_owner(session: Session, parsed: ParsedPayload, now: datetime) -> Employee | None:
    """The owner of a real, working card who may punch by phone, or None. Unlike a phone punch,
    the card must be valid here: it is the only proof of identity a QR worker has (rule 5)."""
    card = session.scalar(select(QrCredential).where(QrCredential.card_serial == parsed.serial))
    if card is None or card.key_id != parsed.key_id or card.employee_id is None:
        return None
    day = to_ist(now).date()
    if (
        card.kind == CardKind.TEST.value
        or card.revoked_at is not None
        or day < card.valid_from
        or day > card.valid_until
    ):
        return None
    employee = session.get(Employee, card.employee_id)
    if (
        employee is None
        or employee.status != EmployeeStatus.ACTIVE.value
        or employee.punch_method != PunchMethod.QR.value
        or not phone_punch_on(session, employee.id)
    ):
        return None
    return employee


def _check_place(
    session: Session, employee: Employee, request: CardProofRequest, now: datetime
) -> None:
    """Rule 12, gate variant: inside the own plant's fence (the margin is fine), so a card proof
    can only be done at the plant. A reading older than the setting counts as no reading."""
    reported = request.location
    max_age = get_int_setting(session, "phone_location_max_age_seconds")
    location = None
    if reported is not None and reported.age_s is not None and reported.age_s <= max_age:
        location = Location(reported.lat, reported.lon, reported.accuracy_m)
    plant_id = employee_plant_on(session, employee, to_ist(now).date(), True)
    verdict = check_location(session, plant_id, location)
    if verdict.refusal_code is not None:
        session.commit()  # the proof row stays as a trail (deleted after a day)
        raise ApiError(
            verdict.refusal_code,
            LOCATION_MESSAGES[verdict.refusal_code],
            422,
            verdict.details,
        )


# --- Pass and fail --------------------------------------------------------------------------------


def _pass(
    session: Session, proof: PhoneProof, employee: Employee, now: datetime, started: float
) -> PassedProof:
    token = secrets.token_urlsafe(32)  # 43 characters; only its hash is stored
    proof.result = "passed"
    proof.employee_id = employee.id
    proof.token_sha256 = token_hash(token)
    expires_at = now + PROOF_TOKEN_LIFE
    proof.token_expires_at = expires_at
    session.commit()
    _wait_until(started)
    return PassedProof(token, expires_at, employee)


def _fail(
    session: Session,
    proof: PhoneProof,
    ip: str,
    started: float,
    *,
    count_for_everyone: bool = False,
) -> NoReturn:
    """One answer for every "not you" case. The audit keeps the kind and the typed code only,
    never a picture or a score (rule 5). Always raises. Only a failure that used the face
    worker counts towards the company-wide limit: a junk card text is cheap and the IP can be
    faked, so counting it would let one person lock everyone out."""
    proof.result = "failed"
    if count_for_everyone:
        failed_proof_limiter.record(EVERYONE)
    record_audit(
        session,
        actor=Actor("employee", None, ip),
        action="phone_proof.failed",
        entity_type="phone_proof",
        entity_id=None,
        after={"kind": proof.kind, "code": proof.claimed_code},
    )
    session.commit()
    _wait_until(started)
    raise ApiError(
        "PROOF_FAILED",
        "We could not confirm it is you. Please try again, or visit the plant office.",
        401,
    )


def _wait_until(started: float) -> None:
    remaining = MIN_ANSWER_SECONDS - (time.monotonic() - started)
    if remaining > 0:
        time.sleep(remaining)


def _check_proof_limits(ip: str) -> None:
    if failed_proof_limiter.blocked(EVERYONE) or not proof_ip_limiter.allow(ip):
        raise ApiError("TOO_MANY_REQUESTS", "Too many checks right now. Try again later.", 429)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --- Set the password -----------------------------------------------------------------------------


def set_password(
    session: Session, *, proof_token: str, new_password: str, ip: str, user_agent: str | None
) -> SignedIn:
    """Rule 5 "Set password": token → rules → one transaction with the new hash, every other
    sign-in ended (`new_password`) and a new sign-in. Works while the account is locked."""
    if not password_set_limiter.allow(ip):
        raise ApiError("TOO_MANY_REQUESTS", "Too many tries. Try again later.", 429)
    now = utc_now()
    proof = session.scalar(
        select(PhoneProof)
        .where(PhoneProof.token_sha256 == token_hash(proof_token))
        .with_for_update()
    )
    employee = session.get(Employee, proof.employee_id) if proof and proof.employee_id else None
    if (
        proof is None
        or employee is None
        or proof.result != "passed"
        or proof.token_used_at is not None
        or proof.token_expires_at is None
        or proof.token_expires_at < now
        or employee.status != EmployeeStatus.ACTIVE.value
    ):
        raise ApiError("PROOF_TOKEN_INVALID", "This check has expired. Please check again.", 401)
    # A weak password does not use up the token: the person simply types a better one.
    check_employee_password(new_password, employee.employee_code)
    if not phone_punch_on(session, employee.id):
        raise phone_punch_off()
    with password_check_slot():
        new_hash = hash_password(new_password)

    lock_employee(session, employee.id)
    proof_kind = "face" if proof.kind == ProofKind.FACE.value else "card"
    account = account_row(session, employee.id)
    account.password_hash = new_hash
    account.password_set_at = now
    account.proof_kind = proof_kind
    account.failed_login_count = 0
    account.locked_until = None
    account.new_password_required_at = None
    proof.token_used_at = now
    # A reset signs out a phone someone else may have been using (rule 5).
    ended = end_all(session, employee.id, SessionRevokeKind.NEW_PASSWORD, now)
    record_audit(
        session,
        actor=Actor("employee", employee.id, ip),
        action="phone_account.password_set",
        entity_type="employee",
        entity_id=employee.id,
        after={"proof_kind": proof_kind, "sessions_ended": ended},
        plant_id=employee.plant_id,
    )
    return finish_sign_in(
        session, employee, method=SignInMethod.PROOF, ip=ip, user_agent=user_agent, now=now
    )


def _ip_or_none(ip: str) -> str | None:
    return None if ip == "unknown" else ip
