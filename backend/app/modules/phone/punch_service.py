"""Punching with the employee's own phone: the face challenge, the face punch and the gate-code
punch (M4b spec §5.3, §7 rules 10, 11, 12, 13, 17).

The server decides everything: the phone sends a live face (or the scanned gate code with a selfie),
a fresh location and nothing it could be trusted for. A face employee punches by face, a QR
(temporary) employee by gate code; the other path answers EMPLOYEE_NOT_QR / EMPLOYEE_NOT_FACE.
Every decided punch is one row of `punches` (channel `phone`): accepted, flagged or rejected.
A retry with the same `client_punch_id` from the same sign-in gets the stored answer.

Order of a face punch: request checks (no row) → location rule (before any face work) → the single
face worker (challenge, frames, liveness, anti-spoof, same person, 1:1 match against the signed-in
employee's own template) → IN/OUT with the employee's row locked, one IN and one OUT per shift,
travel and two-device flags → one transaction stores the row and, for a refusal, a small photo.
Frames and embeddings are never stored (spec §7 rule 10, step 7).
"""

import base64
import binascii
import hashlib
import ipaddress
import logging
import secrets
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.antiproxy.context import DeviceIdentity, Outcome, PunchContext, PunchLimits, RuleResult
from app.antiproxy.engine import (
    GATE_CODE_RULES,
    PHONE_FACE_RULES,
    PHONE_LOCATION_RULES,
    EngineDecision,
    combine,
    rejected_after,
    run_face_rules,
    run_rules,
)
from app.antiproxy.face_context import FaceFrame, FaceLimits, FacePunchContext
from app.antiproxy.facts_at_time import employee_plant_on
from app.antiproxy.rules.face_challenge import nonce_hash
from app.antiproxy.rules.snapshot import check_snapshot
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.storage import Storage
from app.core.time import to_ist, utc_now
from app.face.engine import FaceEngine
from app.face.models import FaceModels
from app.modules.attendance.service import mark_punch_stale
from app.modules.audit.service import record_audit
from app.modules.auth.rate_limit import RateLimiter
from app.modules.employees.models import Employee, PunchMethod
from app.modules.face.engine_provider import face_key, ready_model_id, run_face_job
from app.modules.face.enrolment_service import open_template
from app.modules.face.template_service import active_template
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.kiosks.schemas import LocationReport
from app.modules.phone.access import access_of, outside_work_allowed_on
from app.modules.phone.dependencies import PhoneEmployee
from app.modules.phone.gate_code import parse_gate_code
from app.modules.phone.notice import require_notice_accepted
from app.modules.phone.rate_limits import phone_challenge_limiter, phone_punch_limiter
from app.modules.phone.schemas import (
    PhoneChallengeResponse,
    PhoneFacePunchRequest,
    PhoneGateCodePunchRequest,
    PhonePunchDetails,
    PhonePunchResponse,
)
from app.modules.phone.views import face_ready
from app.modules.punches.answers import FACE_RETRY_CODES
from app.modules.punches.face_service import (
    CHALLENGE_KEEP,
    NO_PHOTO_CODES,
    capture_rules,
    choose_challenge,
    decode_frame,
    face_snapshot,
    load_face_limits,
    lock_and_decide_in_out,
    score_decimal,
)
from app.modules.punches.models import (
    MatchMode,
    Punch,
    PunchChallenge,
    PunchChannel,
    PunchDecision,
    PunchSnapshot,
    SnapshotReason,
)
from app.modules.punches.models import PunchMethod as PunchRowMethod
from app.modules.punches.offline_face_service import EMPTY_GALLERY
from app.modules.punches.service import (
    delete_file_quietly,
    load_limits,
    metres,
    note_last_punch,
    store_snapshot,
)
from app.modules.settings.service import get_int_setting

logger = logging.getLogger(__name__)

# A refused phone face punch keeps no photo when it carries no new evidence (rule 10, step 6).
NO_PHONE_PHOTO_CODES = (*NO_PHOTO_CODES, "SHIFT_ALREADY_CLOSED")
# Called after the commit with the stored selfie, for the F-30 "is there a face" check.
PhotoCheck = Callable[[uuid.UUID, bytes], None]


# --- Checks that refuse the request itself (no row is written) ------------------------------------


def _require_method(employee: Employee, wanted: PunchMethod) -> None:
    """A face employee punches by face, a QR employee by the gate code (rule 2)."""
    if employee.punch_method == wanted.value:
        return
    if wanted is PunchMethod.FACE:
        raise ApiError(
            "EMPLOYEE_NOT_FACE",
            "You punch with the phone code at the gate. Please visit the plant office "
            "if this is wrong.",
            403,
        )
    raise ApiError(
        "EMPLOYEE_NOT_QR",
        "You punch with your face. Please visit the plant office if this is wrong.",
        403,
    )


def _require_face_ready(session: Session, employee: Employee) -> None:
    if not face_ready(session, employee):
        raise ApiError(
            "PHONE_FACE_NOT_READY",
            "Your face is not set up for attendance. Please visit the plant office.",
            409,
        )


def _require_rate(limiter: RateLimiter, caller: PhoneEmployee) -> None:
    """At most 10 challenges and 10 punches a minute per phone sign-in (rule 8)."""
    if not limiter.allow(str(caller.phone_session.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many tries. Please wait a minute.", 429)


# --- The challenge (spec §5.3) --------------------------------------------------------------------


def issue_challenge(
    session: Session, caller: PhoneEmployee, engine: FaceEngine
) -> PhoneChallengeResponse:
    employee = caller.employee
    require_notice_accepted(session, employee.id)
    _require_method(employee, PunchMethod.FACE)
    _require_face_ready(session, employee)
    _require_rate(phone_challenge_limiter, caller)
    face_key()  # FACE_NOT_CONFIGURED before the person even starts
    ready_model_id(engine)  # FACE_SERVICE_UNAVAILABLE while the models load

    now = utc_now()
    phone_session_id = caller.phone_session.id
    session.execute(
        delete(PunchChallenge).where(
            PunchChallenge.phone_session_id == phone_session_id,
            PunchChallenge.issued_at < now - CHALLENGE_KEEP,
        )
    )
    challenge = choose_challenge(session)
    nonce = secrets.token_urlsafe(16)  # 128 random bits
    expires_at = now + timedelta(seconds=get_int_setting(session, "face_challenge_seconds"))
    session.add(
        PunchChallenge(
            phone_session_id=phone_session_id,
            nonce_sha256=nonce_hash(nonce),
            challenge=challenge,
            issued_at=now,
            expires_at=expires_at,
        )
    )
    session.commit()
    return PhoneChallengeResponse(
        challenge_nonce=nonce,
        challenge=challenge,  # type: ignore[arg-type]
        expires_at=expires_at,
        server_time=now,
        capture=capture_rules(session),
    )


# --- The face punch -------------------------------------------------------------------------------


def record_face_punch(
    session: Session,
    caller: PhoneEmployee,
    request: PhoneFacePunchRequest,
    engine: FaceEngine,
    storage: Storage | None = None,
) -> PhonePunchResponse:
    employee = caller.employee
    phone_session_id = caller.phone_session.id
    require_notice_accepted(session, employee.id)
    _require_method(employee, PunchMethod.FACE)
    stored = find_phone_punch(session, phone_session_id, request.client_punch_id)
    if stored is not None:
        return phone_answer(stored)
    _require_face_ready(session, employee)
    _require_rate(phone_punch_limiter, caller)

    limits = load_limits(session)
    now = utc_now()  # before waiting for the face worker: the challenge expiry is judged on it
    key = face_key()
    model_id = ready_model_id(engine)
    face_limits = load_face_limits(session)
    frames = [FaceFrame(role=item.role, jpeg=decode_frame(item.jpeg)) for item in request.frames]

    place = _place_context(session, caller, now, limits, request.location)
    decision, context = _judge_face(
        session, caller, request, engine, place, frames, face_limits, now, key, model_id
    )

    punch = _face_punch_row(caller, request, context, decision, place, now, model_id)
    first_code = decision.reason_codes[0] if decision.outcome is Outcome.REJECT else None
    snapshot = face_snapshot(
        session,
        punch,
        frames,
        first_code,
        now,
        storage,
        rejected_reason=SnapshotReason.PHONE_FACE_REJECTED,
        no_photo_codes=NO_PHONE_PHOTO_CODES,
    )
    saved = _save_punch_once(session, caller, request.client_punch_id, punch, snapshot, storage)
    return phone_answer(saved)


def _judge_face(
    session: Session,
    caller: PhoneEmployee,
    request: PhoneFacePunchRequest,
    engine: FaceEngine,
    place: PunchContext,
    frames: list[FaceFrame],
    face_limits: FaceLimits,
    now: datetime,
    key: bytes,
    model_id: str,
) -> tuple[EngineDecision, FacePunchContext | None]:
    """Rules 11 to 13 for one phone face punch: the place first (a wrong place never reaches the
    face worker), then the face and the IN/OUT rules. Returns the decision and the face context
    (None when the face worker was not used)."""
    place_decision = run_rules(place, PHONE_LOCATION_RULES)
    if place_decision.outcome is Outcome.REJECT:
        return place_decision, None

    employee = caller.employee
    template = _own_template(session, employee, model_id, key)

    def job(models: FaceModels) -> tuple[RuleResult, FacePunchContext]:
        face_context = FacePunchContext(
            session=session,
            plant_id=place.plant_id,
            device_identity=DeviceIdentity.of_phone_session(caller.phone_session.id),
            now=now,
            limits=face_limits,
            models=models,
            gallery=EMPTY_GALLERY,
            challenge_nonce=request.challenge_nonce,
            frames=frames,
            expected_employee=employee,
            own_template=template,
        )
        return run_face_rules(face_context, PHONE_FACE_RULES), face_context

    result, context = run_face_job(engine, job)
    if result.outcome is Outcome.ALLOW and context.employee is not None:
        place.employee = employee
        return combine(place_decision, lock_and_decide_in_out(session, place)), context
    return rejected_after(place_decision, result.reason_code or "INTERNAL_ERROR"), context


def _save_punch_once(
    session: Session,
    caller: PhoneEmployee,
    client_punch_id: uuid.UUID,
    punch: Punch,
    snapshot: PunchSnapshot | None,
    storage: Storage | None,
    device: KioskDevice | None = None,
) -> Punch:
    """Save the punch (and its photo) in one transaction. A retry of the same client_punch_id
    loses the race against the unique rule and gets the stored winner back instead."""
    try:
        session.add(punch)
        session.flush()  # the unique (phone sign-in, client_punch_id) rule is checked here
        if snapshot is not None:
            session.add(snapshot)
        if device is not None:
            note_last_punch(device, punch)
        mark_punch_stale(session, punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        winner = find_phone_punch(session, caller.phone_session.id, client_punch_id)
        if winner is None:
            raise
        return winner
    except Exception:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        raise
    return punch


def _own_template(
    session: Session, employee: Employee, model_id: str, key: bytes
) -> np.ndarray | None:
    """The signed-in employee's opened template of the running model (None = none usable)."""
    template = active_template(session, employee.id)
    if template is None or template.model_id != model_id:
        return None
    return open_template(template, key)


def _face_punch_row(
    caller: PhoneEmployee,
    request: PhoneFacePunchRequest,
    context: FacePunchContext | None,
    decision: EngineDecision,
    place: PunchContext,
    now: datetime,
    model_id: str,
) -> Punch:
    counts = decision.outcome is Outcome.ALLOW
    matched = context.employee if context is not None else None
    return Punch(
        id=uuid.uuid4(),
        client_punch_id=request.client_punch_id,
        channel=PunchChannel.PHONE.value,
        phone_session_id=caller.phone_session.id,
        kiosk_id=None,
        plant_id=place.plant_id,
        employee_id=matched.id if matched else None,
        # A refusal before or without a match names the signed-in employee, so the Super Admin
        # may approve it (spec §7 rule 17; M4 rule 7).
        claimed_employee_id=None if matched else caller.employee.id,
        method=PunchRowMethod.FACE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision.decision_value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        **_location_columns(request.location),
        geofence_id=place.geofence_id,
        geofence_distance_m=metres(place.geofence_distance_m),
        location_plant_id=place.location_plant_id,
        related_punch_id=place.related_punch_id,
        ip=_ip_or_none(caller.ip),
        app_version=request.app_version,
        match_mode=MatchMode.ONE_TO_ONE.value
        if context is not None and context.one_to_one_score is not None
        else None,
        match_score=score_decimal(context.one_to_one_score if context else None),
        antispoof_score=score_decimal(context.antispoof_score if context else None),
        yaw_degrees=_yaw(context),
        challenge=context.challenge if context else None,
        face_model_id=model_id,
    )


def _yaw(context: FacePunchContext | None) -> Decimal | None:
    if context is None or context.yaw_degrees is None:
        return None
    return Decimal(f"{context.yaw_degrees:.1f}")


# --- The gate-code punch --------------------------------------------------------------------------


def record_gate_code_punch(
    session: Session,
    caller: PhoneEmployee,
    request: PhoneGateCodePunchRequest,
    storage: Storage | None = None,
    after_photo: PhotoCheck | None = None,
) -> PhonePunchResponse:
    employee = caller.employee
    phone_session_id = caller.phone_session.id
    require_notice_accepted(session, employee.id)
    _require_method(employee, PunchMethod.QR)
    stored = find_phone_punch(session, phone_session_id, request.client_punch_id)
    if stored is not None:
        return phone_answer(stored)
    _require_rate(phone_punch_limiter, caller)

    limits = load_limits(session)
    now = utc_now()
    parsed = parse_gate_code(request.gate_code)
    device = session.get(KioskDevice, parsed.device_id) if parsed is not None else None
    if device is None:
        return _code_names_no_device(session, caller, request.gate_code, now)

    # The person is known from the sign-in, so every decided row names them (spec §7 rule 11).
    session.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())
    place = _place_context(session, caller, now, limits, request.location)
    place.employee = employee
    place.gate_code_text = request.gate_code
    place.gate_device = device
    place.snapshot_bytes = _decode_photo(request.photo_jpeg)
    decision = run_rules(place, GATE_CODE_RULES)

    if place.snapshot is None and place.snapshot_bytes:
        # A refusal that came before the photo rule (a wrong place, a weak reading) still keeps the
        # selfie for the review (AC-33); a photo that cannot be read simply stays out.
        check_snapshot(place)
    punch = _gate_code_row(caller, request, device, decision, place, now)
    snapshot = store_snapshot(
        session, punch, place, decision, now, storage, reason=SnapshotReason.PHONE_GATE_CODE
    )
    saved = _save_punch_once(
        session, caller, request.client_punch_id, punch, snapshot, storage, device=device
    )
    if saved is not punch:
        return phone_answer(saved)  # a retry won the race: its stored answer
    if after_photo is not None and snapshot is not None and place.snapshot is not None:
        after_photo(snapshot.id, place.snapshot.jpeg)  # F-30, as for a card photo
    return phone_answer(punch)


def _code_names_no_device(
    session: Session, caller: PhoneEmployee, gate_code: str, now: datetime
) -> PhonePunchResponse:
    """A text that names no known gate device cannot be stored as a punch: every gate-code row
    must name its device (migration 0027 check). It is answered like a forged code. The only trace
    is one audit row with the employee and a hash of the text (never the text itself)."""
    logger.warning("A phone gate code named no known device")
    record_audit(
        session,
        actor=caller.actor,
        action="phone_punch.gate_code_unknown_device",
        entity_type="employee",
        entity_id=caller.employee.id,
        after={"text_sha256": hashlib.sha256(gate_code.encode("utf-8")).hexdigest()},
        plant_id=caller.employee.plant_id,
    )
    session.commit()
    return PhonePunchResponse(
        punch_id=None,
        decision="rejected",
        reason_code="GATE_CODE_INVALID",
        direction=None,
        punch_time=now,
        outside_plant=False,
        details=PhonePunchDetails(),
    )


def _gate_code_row(
    caller: PhoneEmployee,
    request: PhoneGateCodePunchRequest,
    device: KioskDevice,
    decision: EngineDecision,
    place: PunchContext,
    now: datetime,
) -> Punch:
    counts = decision.outcome is Outcome.ALLOW
    return Punch(
        id=uuid.uuid4(),
        client_punch_id=request.client_punch_id,
        channel=PunchChannel.PHONE.value,
        phone_session_id=caller.phone_session.id,
        kiosk_id=device.id,  # the gate device whose code was scanned
        plant_id=device.plant_id,
        employee_id=caller.employee.id,
        method=PunchRowMethod.GATE_CODE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision.decision_value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        **_location_columns(request.location),
        geofence_id=place.geofence_id,
        geofence_distance_m=metres(place.geofence_distance_m),
        location_plant_id=place.location_plant_id,
        related_punch_id=place.related_punch_id,
        ip=_ip_or_none(caller.ip),
        app_version=request.app_version,
    )


# --- Shared ---------------------------------------------------------------------------------------


def _place_context(
    session: Session,
    caller: PhoneEmployee,
    now: datetime,
    limits: PunchLimits,
    report: LocationReport | None,
) -> PunchContext:
    """What the location rule and the IN/OUT + flag rules read. `plant_id` is the employee's own
    plant on the punch date (it decides which fence is "home" and the attendance register)."""
    employee = caller.employee
    day = to_ist(now).date()
    max_age = get_int_setting(session, "phone_location_max_age_seconds")
    # A reading older than the setting (or without an age) counts as no reading (rule 12).
    fresh = report is not None and report.age_s is not None and report.age_s <= max_age
    location = Location(report.lat, report.lon, report.accuracy_m) if fresh and report else None
    return PunchContext(
        session=session,
        app_settings=get_settings(),
        plant_id=employee_plant_on(session, employee, day, True),
        device_identity=DeviceIdentity.of_phone_session(caller.phone_session.id),
        now=now,
        limits=limits,
        qr_text=None,
        snapshot_bytes=None,
        location=location,
        location_age_s=report.age_s if report else None,
        outside_work_allowed=outside_work_allowed_on(access_of(session, employee.id), day),
    )


def _location_columns(report: LocationReport | None) -> dict[str, object]:
    if report is None:
        return {}
    return {
        "lat": report.lat,
        "lon": report.lon,
        "accuracy_m": report.accuracy_m,
        "location_age_s": report.age_s,
    }


def _decode_photo(photo_text: str | None) -> bytes | None:
    if not photo_text:
        return None
    try:
        return base64.b64decode(photo_text, validate=True)
    except binascii.Error:
        return b"not a photo"  # the snapshot rule answers SNAPSHOT_INVALID


def _ip_or_none(text: str | None) -> str | None:
    """The address is only for logs; "unknown" or any non-address is stored as nothing."""
    try:
        return str(ipaddress.ip_address(text or ""))
    except ValueError:
        return None


def find_phone_punch(
    session: Session, phone_session_id: uuid.UUID, client_punch_id: uuid.UUID
) -> Punch | None:
    return session.scalar(
        select(Punch).where(
            Punch.phone_session_id == phone_session_id, Punch.client_punch_id == client_punch_id
        )
    )


def phone_answer(punch: Punch) -> PhonePunchResponse:
    """Built from the stored row, so a retry gets exactly the first answer. A flagged punch counts
    like an accepted one; only the outside-plant tag is told to the person."""
    counts = punch.decision in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value)
    reason_code = None if counts else (punch.reason_codes[0] if punch.reason_codes else None)
    retry = (
        reason_code in FACE_RETRY_CODES
        if not counts and punch.method == PunchRowMethod.FACE.value
        else None
    )
    return PhonePunchResponse(
        punch_id=punch.id,
        decision="accepted" if counts else "rejected",
        reason_code=reason_code,
        direction=punch.direction if counts else None,  # type: ignore[arg-type]
        punch_time=punch.server_received_at,
        outside_plant=counts and "OUTSIDE_PLANT" in punch.reason_codes,
        details=PhonePunchDetails(retry_allowed=retry),
    )
