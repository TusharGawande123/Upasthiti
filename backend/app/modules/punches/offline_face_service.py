"""Deciding a face punch the gate saved while offline, at sync (M4 spec §7 rule 10).

Order: the device's place (as for every punch) -> the challenge the device chose -> the M3 frame,
liveness, anti-spoof and same-person checks -> 1:1 against the typed code -> IN/OUT and the flag
rules at the proven punch time -> the time flags. It runs on the face worker only when the worker
is free (`try_run`): live punches at the gate always go first, and a busy worker makes the sync
answer "retry later" for this item. Every offline face punch keeps one small photo (code path,
M3 §7 rule 14), except a double punch and unusable frames.
"""

import uuid
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.antiproxy.context import Outcome, PunchContext
from app.antiproxy.engine import (
    AFTER_IDENTITY_RULES,
    LOCATION_RULES,
    OFFLINE_FACE_RULES,
    OFFLINE_TIME_RULES,
    EngineDecision,
    combine,
    rejected_after,
    run_face_rules,
    run_rules,
)
from app.antiproxy.face_context import FaceFrame, FacePunchContext
from app.antiproxy.facts_at_time import employee_plant_on, employee_was_active
from app.antiproxy.rules.offline_face import (
    CodeCandidate,
    check_offline_challenge,
    check_offline_code_match,
)
from app.core.config import get_settings
from app.core.storage import Storage
from app.core.time import to_ist
from app.face.engine import FaceEngine
from app.face.matcher import EMBEDDING_SIZE, Gallery
from app.face.models import FaceModels
from app.modules.employees.models import Employee, PunchMethod
from app.modules.employees.rules import clean_code
from app.modules.face.engine_provider import face_key
from app.modules.face.enrolment_service import open_template
from app.modules.face.template_service import active_template
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.answers import punch_answer
from app.modules.punches.face_service import (
    NO_PHOTO_CODES,
    decode_frame,
    load_face_limits,
    place_context,
    score_decimal,
    small_photo,
)
from app.modules.punches.models import (
    MatchMode,
    Punch,
    PunchSnapshot,
    SnapshotReason,
    SnapshotState,
)
from app.modules.punches.models import (
    PunchMethod as PunchKind,
)
from app.modules.punches.offline_time import OfflinePunch
from app.modules.punches.schemas import KioskPunchResponse
from app.modules.punches.service import (
    ClientInfo,
    delete_file_quietly,
    find_punch,
    load_limits,
    metres,
    note_last_punch,
    offline_columns,
    upload_snapshot,
)
from app.modules.settings.service import get_float_setting, get_int_setting

EMPTY_GALLERY = Gallery([], np.zeros((0, EMBEDDING_SIZE), dtype=np.float32))  # 1:1 needs none


class OfflineFaceEvidence:
    """What the sealed evidence of an offline face punch held, after the server opened it."""

    def __init__(self, employee_code: str, frames: list[tuple[str, str]]) -> None:
        self.employee_code = employee_code
        self.frames = frames  # (role, base64 JPEG)


def record_offline_face_punch(
    session: Session,
    kiosk: KioskDevice,
    *,
    client_punch_id: uuid.UUID,
    challenge: str | None,
    evidence: OfflineFaceEvidence,
    location: Location,
    location_age_s: int,
    offline: OfflinePunch,
    client: ClientInfo,
    engine: FaceEngine,
    app_version: str | None,
    storage: Storage | None = None,
) -> KioskPunchResponse | None:
    """The answer, or None when the face worker is busy or not loaded yet (retry later)."""
    limits = load_limits(session)
    stored = find_punch(session, kiosk, client_punch_id)
    if stored is not None:
        return punch_answer(session, stored, kiosk.name, limits)
    model_id = engine.model_id
    if model_id is None:
        return None

    key = face_key()
    now = offline.punch_time
    frames = [FaceFrame(role=role, jpeg=decode_frame(jpeg)) for role, jpeg in evidence.frames]
    place = place_context(session, kiosk, now, limits, location)
    place.location_age_s = location_age_s
    place.is_offline = True
    place.time_proof = offline.time_proof
    place.received_at = offline.received_at
    place_decision = run_rules(place, LOCATION_RULES)
    candidate = _code_candidate(session, evidence.employee_code, model_id, key, place)

    context: FacePunchContext | None = None
    if place_decision.outcome is Outcome.REJECT:
        decision = place_decision
    else:
        face_limits = load_face_limits(session)
        steps = get_int_setting(session, "face_challenge_steps")
        threshold = get_float_setting(session, "face_code_match_threshold")

        def job(models: FaceModels) -> tuple[str | None, FacePunchContext]:
            checked = FacePunchContext(
                session=session,
                kiosk=kiosk,
                now=now,
                limits=face_limits,
                models=models,
                gallery=EMPTY_GALLERY,
                challenge_nonce="",
                frames=frames,
            )
            for step in (
                lambda: check_offline_challenge(checked, challenge, steps),
                lambda: run_face_rules(checked, OFFLINE_FACE_RULES),
                lambda: check_offline_code_match(checked, candidate, threshold),
            ):
                result = step()
                if result.outcome is Outcome.REJECT:
                    return result.reason_code, checked
            return None, checked

        outcome = engine.try_run(job)
        if outcome is None:
            return None
        refusal, context = outcome
        if refusal is None and context.employee is not None:
            place.employee = context.employee
            session.execute(
                select(Employee.id).where(Employee.id == context.employee.id).with_for_update()
            )
            after = run_rules(place, (*AFTER_IDENTITY_RULES, *OFFLINE_TIME_RULES))
            decision = combine(place_decision, after)
        else:
            decision = rejected_after(place_decision, refusal or "FACE_NOT_RECOGNISED")

    punch = _offline_face_row(
        kiosk, client_punch_id, client, context, candidate, decision, place, offline, model_id
    )
    punch.app_version = app_version
    snapshot = _offline_photo(session, punch, frames, decision, now, storage)
    try:
        session.add(punch)
        session.flush()
        if snapshot is not None:
            session.add(snapshot)
        note_last_punch(kiosk, punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        winner = find_punch(session, kiosk, client_punch_id)
        if winner is None:
            raise
        return punch_answer(session, winner, kiosk.name, limits)
    except Exception:
        session.rollback()
        delete_file_quietly(snapshot, storage)
        raise
    return punch_answer(session, punch, kiosk.name, limits)


def _code_candidate(
    session: Session, code: str, model_id: str, key: bytes, place: PunchContext
) -> CodeCandidate | None:
    """The employee whose code was typed. Only an active face employee with a template of the
    running model can match; for anyone else the template is None (same refusal for all)."""
    employee = session.scalar(select(Employee).where(Employee.employee_code == clean_code(code)))
    if employee is None:
        return None
    day = to_ist(place.now).date()
    at_punch_time = place.judges_at_punch_time
    template_vector = None
    if employee.punch_method == PunchMethod.FACE.value and employee_was_active(
        employee, day, at_punch_time
    ):
        template = active_template(session, employee.id)
        if template is not None and template.model_id == model_id:
            template_vector = open_template(template, key)
    plant_id = employee_plant_on(session, employee, day, at_punch_time)
    return CodeCandidate(employee, template_vector, plant_id)


def _offline_face_row(
    kiosk: KioskDevice,
    client_punch_id: uuid.UUID,
    client: ClientInfo,
    context: FacePunchContext | None,
    candidate: CodeCandidate | None,
    decision: EngineDecision,
    place: PunchContext,
    offline: OfflinePunch,
    model_id: str,
) -> Punch:
    counts = decision.outcome is Outcome.ALLOW
    location = place.location
    return Punch(
        id=uuid.uuid4(),
        client_punch_id=client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=context.employee.id if context and context.employee else None,
        method=PunchKind.FACE.value,
        direction=decision.direction.value if counts and decision.direction else None,
        decision=decision.decision_value,
        reason_codes=decision.reason_codes,
        **offline_columns(offline, offline.punch_time),
        lat=location.lat if location else None,
        lon=location.lon if location else None,
        accuracy_m=location.accuracy_m if location else None,
        location_age_s=place.location_age_s,
        geofence_id=place.geofence_id,
        geofence_distance_m=metres(place.geofence_distance_m),
        related_punch_id=place.related_punch_id,
        ip=client.ip,
        match_mode=MatchMode.CODE.value,
        match_score=score_decimal(context.code_score if context else None),
        antispoof_score=score_decimal(context.antispoof_score if context else None),
        challenge=context.challenge if context else None,
        face_model_id=model_id,
        claimed_employee_id=candidate.employee.id if candidate else None,
    )


def _offline_photo(
    session: Session,
    punch: Punch,
    frames: list[FaceFrame],
    decision: EngineDecision,
    now: datetime,
    storage: Storage | None,
) -> PunchSnapshot | None:
    """One 320 px photo of every offline face punch (accepted too), for the review."""
    first_code = decision.reason_codes[0] if decision.outcome is Outcome.REJECT else None
    if first_code in NO_PHOTO_CODES:
        return None
    checked = small_photo(frames, get_int_setting(session, "snapshot_dark_threshold"))
    if checked is None:
        return None
    storage_key = f"snapshots/{now:%Y/%m/%d}/{punch.id}.bin"
    stored_size = upload_snapshot(punch, checked, storage_key, get_settings(), storage)
    return PunchSnapshot(
        punch_id=punch.id,
        storage_key=storage_key,
        size_bytes=stored_size or 0,
        width=checked.width,
        height=checked.height,
        brightness=checked.brightness,
        is_dark=checked.is_dark,
        taken_at=now,
        expires_at=now + timedelta(days=get_int_setting(session, "snapshot_retention_days")),
        state=SnapshotState.STORED.value if stored_size else SnapshotState.UPLOAD_FAILED.value,
        reason=SnapshotReason.FACE_OFFLINE.value,
    )
