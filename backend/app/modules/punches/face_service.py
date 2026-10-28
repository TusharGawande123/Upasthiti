"""Face punches at the gate: the challenge, the face punch and the employee-code try (spec M3 §5.1,
§5.2, §7 rules 5, 7, 14).

The device only sends signed evidence (frames); the server decides everything. Order of a face
punch: a retry gets the stored answer; the receive time is taken; the single face worker runs
the face rules (challenge, frames, liveness, anti-spoof, same person, 1:N match); then, outside
the worker and with the employee's row locked, the M2 IN/OUT rule; then one transaction stores
the punch, a photo when it was rejected or needs the code, and the pending code entry. Frames,
crops and embeddings are never stored or logged (only the unsure embedding, encrypted, for 90 s).
"""

import base64
import binascii
import hashlib
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import cv2
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.antiproxy.context import Outcome, PunchContext, PunchLimits, RuleResult
from app.antiproxy.engine import (
    AFTER_IDENTITY_RULES,
    LOCATION_RULES,
    EngineDecision,
    combine,
    rejected_after,
    run_face_rules,
    run_rules,
)
from app.antiproxy.face_context import FaceFrame, FaceLimits, FacePunchContext
from app.antiproxy.rules.face_challenge import nonce_hash
from app.antiproxy.rules.face_frames import MAX_FRAME_BYTES
from app.core.config import get_settings
from app.core.crypto import (
    FaceDecryptionError,
    SealedVector,
    open_vector,
    pending_match_binding,
    seal_vector,
)
from app.core.storage import Storage
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.face.images import ImageInvalidError, decode_jpeg
from app.face.matcher import cosine
from app.face.models import FaceModels
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.employees.rules import clean_code
from app.modules.face.engine_provider import face_key, ready_model_id, run_face_job
from app.modules.face.enrolment_service import open_template
from app.modules.face.gallery_cache import plant_gallery
from app.modules.face.template_service import active_template
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.answers import ALREADY_PUNCHED_CODES, punch_answer
from app.modules.punches.models import (
    FacePendingMatch,
    MatchMode,
    Punch,
    PunchChallenge,
    PunchDecision,
    PunchSnapshot,
    SnapshotReason,
    SnapshotState,
)
from app.modules.punches.schemas import (
    CaptureRules,
    ChallengeResponse,
    CodeEntry,
    CodeTryRequest,
    KioskPunchRequest,
    KioskPunchResponse,
    PunchDetails,
)
from app.modules.punches.service import (
    ClientInfo,
    delete_file_quietly,
    find_punch,
    load_limits,
    metres,
    note_last_punch,
    reported_location,
    upload_snapshot,
)
from app.modules.punches.snapshots import CheckedSnapshot, SnapshotInvalidError, inspect_snapshot
from app.modules.settings.service import get_float_setting, get_int_setting

logger = logging.getLogger(__name__)

CHALLENGE_KEEP = timedelta(days=1)
SNAPSHOT_WIDTH = 320
# Rejections that keep no photo: "already punched" carries no new evidence, unreadable frames
# give no usable picture (spec §7 rule 14).
NO_PHOTO_CODES = (*ALREADY_PUNCHED_CODES, "FRAMES_INVALID")
# Every failed code try answers no faster than this, so the timing never tells whether a typed
# code exists (spec §7 rule 7).
MIN_FAILURE_SECONDS = 0.3


# --- The challenge (spec §5.1) ----------------------------------------------------------------


def issue_challenge(session: Session, kiosk: KioskDevice, engine: FaceEngine) -> ChallengeResponse:
    face_key()  # FACE_NOT_CONFIGURED before the person even starts
    ready_model_id(engine)  # FACE_SERVICE_UNAVAILABLE while the models load
    now = utc_now()
    session.execute(
        delete(PunchChallenge).where(
            PunchChallenge.kiosk_id == kiosk.id, PunchChallenge.issued_at < now - CHALLENGE_KEEP
        )
    )
    two_steps = get_int_setting(session, "face_challenge_steps") >= 2  # F-43
    options = ("left_then_right", "right_then_left") if two_steps else ("turn_left", "turn_right")
    challenge = secrets.choice(options)  # chosen by the server, never by the device
    nonce = secrets.token_urlsafe(16)  # 128 random bits, 22 characters
    expires_at = now + timedelta(seconds=get_int_setting(session, "face_challenge_seconds"))
    session.add(
        PunchChallenge(
            kiosk_id=kiosk.id,
            nonce_sha256=nonce_hash(nonce),
            challenge=challenge,
            issued_at=now,
            expires_at=expires_at,
        )
    )
    session.commit()
    return ChallengeResponse(
        challenge_nonce=nonce,
        challenge=challenge,  # type: ignore[arg-type]
        expires_at=expires_at,
        server_time=now,
        capture=CaptureRules(
            min_frames=2,
            max_frames=4,
            max_width=640,
            max_height=480,
            max_frame_bytes=MAX_FRAME_BYTES,
            min_yaw_degrees=get_int_setting(session, "face_min_yaw_degrees"),
        ),
    )


# --- The face punch (spec §5.2, §7 rule 5) ----------------------------------------------------


def load_face_limits(session: Session) -> FaceLimits:
    return FaceLimits(
        match_threshold=get_float_setting(session, "face_match_threshold"),
        match_margin=get_float_setting(session, "face_match_margin"),
        code_offer_floor=get_float_setting(session, "face_code_offer_floor"),
        consistency_threshold=get_float_setting(session, "face_consistency_threshold"),
        antispoof_threshold=get_float_setting(session, "face_antispoof_threshold"),
        min_yaw_degrees=get_float_setting(session, "face_min_yaw_degrees"),
        frontal_max_yaw_degrees=get_float_setting(session, "face_frontal_max_yaw_degrees"),
        min_face_px=get_int_setting(session, "face_min_face_px"),
        blur_min=get_float_setting(session, "face_blur_min"),
        brightness_min=get_float_setting(session, "face_brightness_min"),
    )


def record_face_punch(
    session: Session,
    kiosk: KioskDevice,
    request: KioskPunchRequest,
    client: ClientInfo,
    engine: FaceEngine,
    storage: Storage | None = None,
) -> KioskPunchResponse:
    limits = load_limits(session)
    stored = find_punch(session, kiosk, request.client_punch_id)
    if stored is not None:
        return _stored_answer(session, kiosk, stored, limits)

    now = utc_now()  # before waiting for the face worker: the challenge expiry is judged on it
    key = face_key()
    model_id = ready_model_id(engine)
    face_limits = load_face_limits(session)
    frames = [
        FaceFrame(role=frame.role, jpeg=decode_frame(frame.jpeg)) for frame in request.frames or []
    ]

    def job(models: FaceModels) -> tuple[RuleResult, FacePunchContext]:
        context = FacePunchContext(
            session=session,
            kiosk=kiosk,
            now=now,
            limits=face_limits,
            models=models,
            gallery=plant_gallery(session, kiosk.plant_id, model_id, key),
            challenge_nonce=request.challenge_nonce or "",
            frames=frames,
        )
        return run_face_rules(context), context

    # M4: the device must be at its plant; a device taken home is refused before any face work.
    place = place_context(session, kiosk, now, limits, reported_location(request), request)
    place_decision = run_rules(place, LOCATION_RULES)
    context: FacePunchContext | None = None
    if place_decision.outcome is Outcome.REJECT:
        decision = place_decision
    else:
        result, context = run_face_job(engine, job)
        if result.outcome is Outcome.ALLOW and context.employee is not None:
            place.employee = context.employee
            decision = combine(place_decision, _after_identity(session, place))
        else:
            decision = rejected_after(place_decision, result.reason_code or "INTERNAL_ERROR")

    punch = _face_punch_row(kiosk, request, client, context, decision, place, now, model_id)
    first_code = decision.reason_codes[0] if decision.outcome is Outcome.REJECT else None
    snapshot = _face_snapshot(session, punch, frames, first_code, now, storage)
    pending, token = _pending_match(session, kiosk, punch, context, first_code, now, model_id, key)
    try:
        session.add(punch)
        session.flush()  # the unique (kiosk, client_punch_id) rule is checked here
        if snapshot is not None:
            session.add(snapshot)
        if pending is not None:
            session.add(pending)
        note_last_punch(kiosk, punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        winner = find_punch(session, kiosk, request.client_punch_id)
        if winner is None:
            raise
        return _stored_answer(session, kiosk, winner, limits)
    except Exception:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        raise
    answer = punch_answer(session, punch, kiosk.name, limits)
    if pending is not None and token is not None:
        answer.code_entry = CodeEntry(
            token=token, expires_at=pending.expires_at, tries_left=pending.tries_left
        )
    return answer


def decode_frame(text: str) -> bytes:
    """Bad base64 becomes empty bytes, which the frames rule refuses as FRAMES_INVALID."""
    try:
        return base64.b64decode(text, validate=True)
    except binascii.Error:
        return b""


def place_context(
    session: Session,
    kiosk: KioskDevice,
    now: datetime,
    limits: PunchLimits,
    location: Location | None,
    request: KioskPunchRequest | None = None,
) -> PunchContext:
    """The card-free context the location rules and the IN/OUT + flag rules read."""
    return PunchContext(
        session=session,
        app_settings=get_settings(),
        kiosk=kiosk,
        now=now,
        limits=limits,
        qr_text=None,
        snapshot_bytes=None,
        location=location,
        location_age_s=request.location.age_s if request and request.location else None,
    )


def _after_identity(session: Session, context: PunchContext) -> EngineDecision:
    """IN/OUT and the flag rules, with the employee's row locked (two gates at once)."""
    employee = context.employee
    if employee is None:
        raise RuntimeError("the face must be matched before IN/OUT is decided")
    session.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())
    return run_rules(context, AFTER_IDENTITY_RULES)


def score_decimal(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(f"{value:.4f}")


def _face_punch_row(
    kiosk: KioskDevice,
    request: KioskPunchRequest,
    client: ClientInfo,
    context: FacePunchContext | None,
    decision: EngineDecision,
    place: PunchContext,
    now: datetime,
    model_id: str,
) -> Punch:
    counts = decision.outcome is Outcome.ALLOW
    if decision.reason_codes[:1] == ["NEED_EMPLOYEE_CODE"]:
        decision_value = PunchDecision.NEEDS_CODE.value
    else:
        decision_value = decision.decision_value
    match = context.match if context else None
    location = request.location
    return Punch(
        id=uuid.uuid4(),
        client_punch_id=request.client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        # Set only when the face itself matched (accepted, or "already punched").
        employee_id=context.employee.id if context and context.employee else None,
        method=PunchMethod.FACE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision_value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        device_claimed_at=request.device_time,
        lat=location.lat if location else None,
        lon=location.lon if location else None,
        accuracy_m=location.accuracy_m if location else None,
        location_age_s=location.age_s if location else None,
        geofence_id=place.geofence_id,
        geofence_distance_m=metres(place.geofence_distance_m),
        related_punch_id=place.related_punch_id,
        ip=client.ip,
        app_version=request.app_version,
        match_mode=MatchMode.ONE_TO_MANY.value if match is not None else None,
        match_score=score_decimal(match.best_score if match else None),
        second_best_score=score_decimal(match.second_best_score if match else None),
        antispoof_score=score_decimal(context.antispoof_score if context else None),
        yaw_degrees=_yaw(context),
        challenge=context.challenge if context else None,
        face_model_id=model_id,
    )


def _yaw(context: FacePunchContext | None) -> Decimal | None:
    if context is None or context.yaw_degrees is None:
        return None
    return Decimal(f"{context.yaw_degrees:.1f}")


def _face_snapshot(
    session: Session,
    punch: Punch,
    frames: list[FaceFrame],
    first_code: str | None,
    now: datetime,
    storage: Storage | None,
) -> PunchSnapshot | None:
    """A 320 px photo of a rejected or code-path face punch; never for one that counts."""
    counts = punch.decision in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value)
    if counts or first_code in NO_PHOTO_CODES:
        return None
    checked = small_photo(frames, get_int_setting(session, "snapshot_dark_threshold"))
    if checked is None:
        return None
    reason = (
        SnapshotReason.FACE_CODE
        if punch.decision == PunchDecision.NEEDS_CODE.value
        else SnapshotReason.FACE_REJECTED
    )
    key = f"snapshots/{now:%Y/%m/%d}/{punch.id}.bin"
    stored_size = upload_snapshot(punch, checked, key, get_settings(), storage)
    return PunchSnapshot(
        punch_id=punch.id,
        storage_key=key,
        size_bytes=stored_size or 0,
        width=checked.width,
        height=checked.height,
        brightness=checked.brightness,
        is_dark=checked.is_dark,
        taken_at=now,
        expires_at=now + timedelta(days=get_int_setting(session, "snapshot_retention_days")),
        state=SnapshotState.STORED.value if stored_size else SnapshotState.UPLOAD_FAILED.value,
        reason=reason.value,
    )


def small_photo(frames: list[FaceFrame], dark_threshold: int) -> CheckedSnapshot | None:
    """The first frontal frame, made by the server: 320 px wide, re-encoded without metadata."""
    first = next((frame for frame in frames if frame.role == "frontal"), None)
    if first is None:
        return None
    try:
        picture = decode_jpeg(
            first.jpeg, min_width=320, max_width=640, min_height=240, max_height=480
        )
    except ImageInvalidError:
        return None
    height = round(picture.shape[0] * SNAPSHOT_WIDTH / picture.shape[1])
    small = cv2.resize(picture, (SNAPSHOT_WIDTH, height), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return None
    try:
        return inspect_snapshot(encoded.tobytes(), dark_threshold)
    except SnapshotInvalidError:
        return None


def _pending_match(
    session: Session,
    kiosk: KioskDevice,
    punch: Punch,
    context: FacePunchContext | None,
    first_code: str | None,
    now: datetime,
    model_id: str,
    key: bytes,
) -> tuple[FacePendingMatch | None, str | None]:
    """For "needs code": the unsure embedding waits here, encrypted; the device gets a token."""
    if first_code != "NEED_EMPLOYEE_CODE" or context is None or context.embedding is None:
        return None, None
    session.execute(
        delete(FacePendingMatch).where(
            FacePendingMatch.kiosk_id == kiosk.id, FacePendingMatch.expires_at < now
        )
    )
    pending_id = uuid.uuid4()
    sealed = seal_vector(context.embedding, pending_match_binding(pending_id, kiosk.id), key)
    token = secrets.token_urlsafe(32)  # 43 characters; only its hash is stored
    pending = FacePendingMatch(
        id=pending_id,
        kiosk_id=kiosk.id,
        origin_punch_id=punch.id,
        token_sha256=_token_hash(token),
        model_id=model_id,
        nonce=sealed.nonce,
        ciphertext=sealed.ciphertext,
        tries_left=get_int_setting(session, "face_code_max_tries"),
        expires_at=now + timedelta(seconds=get_int_setting(session, "face_code_entry_seconds")),
    )
    return pending, token


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _stored_answer(
    session: Session, kiosk: KioskDevice, punch: Punch, limits: PunchLimits
) -> KioskPunchResponse:
    """A retry of the same punch. A lost "needs code" answer gets a fresh token (the old one
    was never seen by anyone, and only its hash was kept)."""
    answer = punch_answer(session, punch, kiosk.name, limits)
    if punch.decision != PunchDecision.NEEDS_CODE.value:
        return answer
    pending = session.scalar(
        select(FacePendingMatch).where(FacePendingMatch.origin_punch_id == punch.id)
    )
    if pending is None or pending.expires_at < utc_now():
        return answer
    token = secrets.token_urlsafe(32)
    pending.token_sha256 = _token_hash(token)
    session.commit()
    answer.code_entry = CodeEntry(
        token=token, expires_at=pending.expires_at, tries_left=pending.tries_left
    )
    return answer


# --- The employee-code try (spec §5.2, §7 rule 7) ---------------------------------------------


def record_code_try(
    session: Session,
    kiosk: KioskDevice,
    request: CodeTryRequest,
    client: ClientInfo,
) -> KioskPunchResponse:
    started = time.monotonic()
    limits = load_limits(session)
    stored = find_punch(session, kiosk, request.client_punch_id)
    if stored is not None:
        return punch_answer(session, stored, kiosk.name, limits)

    now = utc_now()
    # Locked until the commit: tries sent at the same moment wait for each other, so each one
    # sees the real number of tries left and the limit cannot be beaten in parallel.
    pending = session.scalar(
        select(FacePendingMatch)
        .where(FacePendingMatch.token_sha256 == _token_hash(request.code_entry_token))
        .with_for_update()
    )
    if pending is None or pending.kiosk_id != kiosk.id:
        # Unknown, already finished or another kiosk's token: the same answer as a timeout.
        return _slow(
            started,
            _final_code_row(
                session, kiosk, request, client, now, None, "CODE_ENTRY_EXPIRED", limits
            ),
        )
    if pending.last_try_client_punch_id == request.client_punch_id:
        return _slow(started, _try_again_answer(kiosk, request, pending, now))
    if pending.expires_at < now:
        return _slow(
            started,
            _final_code_row(
                session, kiosk, request, client, now, pending, "CODE_ENTRY_EXPIRED", limits
            ),
        )

    key = face_key()
    claimed = session.scalar(
        select(Employee).where(Employee.employee_code == clean_code(request.employee_code))
    )
    score = _one_to_one(session, pending, claimed, key)
    matched = score is not None and score >= get_float_setting(session, "face_code_match_threshold")

    if matched and claimed is not None:
        if claimed.plant_id != kiosk.plant_id:
            return _slow(
                started,
                _final_code_row(
                    session,
                    kiosk,
                    request,
                    client,
                    now,
                    pending,
                    "WRONG_PLANT",
                    limits,
                    claimed=claimed,
                    employee=claimed,
                    score=score,
                ),
            )
        place = _origin_place(session, kiosk, now, limits, pending)
        place.employee = claimed
        decision = combine(_origin_flags(session, pending), _after_identity(session, place))
        return _final_code_row(
            session,
            kiosk,
            request,
            client,
            now,
            pending,
            decision.reason_codes[0] if decision.outcome is Outcome.REJECT else None,
            limits,
            claimed=claimed,
            employee=claimed,
            score=score,
            decision=decision,
            place=place,
        )

    # Not this person (or no such face employee): one try is used up.
    pending.tries_left -= 1
    if pending.tries_left > 0:
        pending.last_try_client_punch_id = request.client_punch_id
        session.commit()
        return _slow(started, _try_again_answer(kiosk, request, pending, now))
    return _slow(
        started,
        _final_code_row(
            session,
            kiosk,
            request,
            client,
            now,
            pending,
            "FACE_NOT_RECOGNISED",
            limits,
            claimed=claimed,
            score=score,
        ),
    )


def _one_to_one(
    session: Session, pending: FacePendingMatch, claimed: Employee | None, key: bytes
) -> float | None:
    """1:1 score of the waiting face against the typed code's template, if that is possible.

    Only an active face-method employee with a template of the same model can match; any other
    code (unknown, a card worker, not enrolled) simply does not match, with the same answer."""
    if (
        claimed is None
        or claimed.status != EmployeeStatus.ACTIVE.value
        or claimed.punch_method != PunchMethod.FACE.value
    ):
        return None
    template = active_template(session, claimed.id)
    if template is None or template.model_id != pending.model_id:
        return None
    template_vector = open_template(template, key)
    if template_vector is None:
        return None
    try:
        waiting = open_vector(
            SealedVector(pending.nonce, pending.ciphertext),
            pending_match_binding(pending.id, pending.kiosk_id),
            key,
        )
    except FaceDecryptionError:  # a damaged pending row simply does not match
        return None
    return cosine(waiting, template_vector)


def _try_again_answer(
    kiosk: KioskDevice, request: CodeTryRequest, pending: FacePendingMatch, now: datetime
) -> KioskPunchResponse:
    return KioskPunchResponse(
        punch_id=None,
        decision="needs_code",
        direction=None,
        employee=None,
        server_time=now,
        reason_code="CODE_NOT_MATCHED",
        message_key="kiosk.punch.CODE_NOT_MATCHED",
        voice_key="kiosk.punch.CODE_NOT_MATCHED.voice",
        details=PunchDetails(kiosk_name=kiosk.name),
        code_entry=CodeEntry(
            token=request.code_entry_token,
            expires_at=pending.expires_at,
            tries_left=pending.tries_left,
        ),
    )


def _final_code_row(
    session: Session,
    kiosk: KioskDevice,
    request: CodeTryRequest,
    client: ClientInfo,
    now: datetime,
    pending: FacePendingMatch | None,
    reason_code: str | None,
    limits: PunchLimits,
    *,
    claimed: Employee | None = None,
    employee: Employee | None = None,
    score: float | None = None,
    decision: EngineDecision | None = None,
    place: PunchContext | None = None,
) -> KioskPunchResponse:
    """The last answer of a code path: one punch row pointing to the punch that asked for the
    code. The pending row (and its embedding) is deleted in the same transaction. The place
    (position, fence, edge flag) is the one of the punch that asked for the code (M4 §7 rule 4)."""
    if decision is None:
        decision = rejected_after(_origin_flags(session, pending), reason_code or "INTERNAL_ERROR")
    if place is None:
        place = _origin_place(session, kiosk, now, limits, pending)
    counts = decision.outcome is Outcome.ALLOW
    origin = session.get(Punch, pending.origin_punch_id) if pending else None
    punch = Punch(
        id=uuid.uuid4(),
        client_punch_id=request.client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=employee.id if employee else None,
        method=PunchMethod.FACE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision.decision_value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        lat=origin.lat if origin else None,
        lon=origin.lon if origin else None,
        accuracy_m=origin.accuracy_m if origin else None,
        location_age_s=origin.location_age_s if origin else None,
        geofence_id=origin.geofence_id if origin else None,
        geofence_distance_m=origin.geofence_distance_m if origin else None,
        related_punch_id=place.related_punch_id,
        ip=client.ip,
        match_mode=MatchMode.CODE.value,
        match_score=score_decimal(score),
        face_model_id=pending.model_id if pending else None,
        follows_punch_id=pending.origin_punch_id if pending else None,
        claimed_employee_id=claimed.id if claimed else None,
    )
    try:
        session.add(punch)
        if pending is not None:
            session.delete(pending)
        note_last_punch(kiosk, punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        winner = find_punch(session, kiosk, request.client_punch_id)
        if winner is None:
            raise
        punch = winner
    return punch_answer(session, punch, kiosk.name, limits)


def _origin_place(
    session: Session,
    kiosk: KioskDevice,
    now: datetime,
    limits: PunchLimits,
    pending: FacePendingMatch | None,
) -> PunchContext:
    """The place of the punch that asked for the code: no new reading is needed for the same
    person seconds later (M4 spec §7 rule 4)."""
    origin = session.get(Punch, pending.origin_punch_id) if pending else None
    location = None
    if origin is not None and origin.lat is not None and origin.lon is not None:
        accuracy = float(origin.accuracy_m) if origin.accuracy_m is not None else 0.0
        location = Location(float(origin.lat), float(origin.lon), accuracy)
    return place_context(session, kiosk, now, limits, location)


def _origin_flags(session: Session, pending: FacePendingMatch | None) -> EngineDecision:
    """The location flags of the punch that asked for the code, carried to the final row."""
    origin = session.get(Punch, pending.origin_punch_id) if pending else None
    flags = [
        code for code in (origin.reason_codes if origin else []) if code.startswith("LOCATION_")
    ]
    return EngineDecision(Outcome.ALLOW, list(flags), None, flags)


def _slow(started: float, answer: KioskPunchResponse) -> KioskPunchResponse:
    remaining = MIN_FAILURE_SECONDS - (time.monotonic() - started)
    if remaining > 0:
        time.sleep(remaining)
    return answer
