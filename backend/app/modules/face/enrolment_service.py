"""Face enrolment by the Super Admin: a session, 5 checked shots, then one template (spec M3 §7
rule 4, F-39, AC-6 to AC-8, AC-35).

Each accepted shot keeps only its embedding, encrypted, while the session is open (it closes
after two hours without activity); the picture is dropped as soon as the checks are done.
Finishing averages the 5 embeddings into the template, checks that the face is not already
enrolled under another employee, and stores the template encrypted with FACE_TEMPLATE_KEY. The
shots are then deleted.
"""

import base64
import binascii
import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.crypto import (
    FACE_KEY_ID,
    FaceDecryptionError,
    SealedVector,
    enrolment_shot_binding,
    open_vector,
    seal_vector,
    template_binding,
)
from app.core.errors import ApiError
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.face.enrolment_checks import ShotLimits, ShotResult, check_shot
from app.face.matcher import cosine, mean_template
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.face.cleanup import expire_old_sessions
from app.modules.face.consent_service import active_consent
from app.modules.face.engine_provider import (
    face_key,
    ready_engine,
    ready_model_id,
    run_face_job,
)
from app.modules.face.gallery_cache import invalidate_plant_gallery
from app.modules.face.models import (
    ENROLMENT_POSES,
    EnrolmentState,
    FaceEnrolmentSession,
    FaceEnrolmentShot,
    FaceTemplate,
    TemplateDeleteKind,
)
from app.modules.face.template_service import (
    active_template,
    cancel_open_session,
    delete_active_template,
    end_consent_after_erasure,
)
from app.modules.org.models import Plant
from app.modules.settings.service import get_float_setting, get_int_setting

logger = logging.getLogger(__name__)

# Clean-up only: leaving the wizard cancels the session at once. A session whose admin just
# vanished (closed browser, crashed laptop) is closed after this long without a shot, so
# half-finished face data is not kept (decision 0018). The admin sees no countdown.
SESSION_IDLE_MINUTES = 120
MAX_SHOT_BYTES = 150 * 1024
MAX_DUPLICATES_SHOWN = 3
RE_ENROLLED_REASON = "Enrolled again"


@dataclass(frozen=True)
class ShotAnswer:
    result: ShotResult
    shots_done: int
    next_pose: str | None


@dataclass(frozen=True)
class DuplicateMatch:
    employee_id: uuid.UUID
    employee_code: str
    name: str
    plant_code: str
    score: float  # used only for the order; never sent to the browser


@dataclass(frozen=True)
class FinishedEnrolment:
    template: FaceTemplate
    replaced_previous: bool


# --- Start --------------------------------------------------------------------------------------


def start_session(
    session: Session, actor: Actor, employee: Employee, engine: FaceEngine
) -> FaceEnrolmentSession:
    if employee.status == EmployeeStatus.LEFT.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    if employee.punch_method != PunchMethod.FACE.value:
        raise ApiError(
            "EMPLOYEE_NOT_FACE",
            "This employee punches with a QR card. Change the punch method to face first.",
            409,
        )
    consent = active_consent(session, employee.id)
    if consent is None:
        raise ApiError("CONSENT_REQUIRED", "Record the employee's consent first.", 409)
    face_key()  # FACE_NOT_CONFIGURED before any picture is sent
    model_id = ready_model_id(engine)

    now = utc_now()
    expire_old_sessions(session, now, employee_id=employee.id)
    cancel_open_session(session, employee, actor=actor)  # one open session per employee
    row = FaceEnrolmentSession(
        employee_id=employee.id,
        consent_id=consent.id,
        started_by=actor.actor_id,
        started_at=now,
        expires_at=now + timedelta(minutes=SESSION_IDLE_MINUTES),
        model_id=model_id,
        state=EnrolmentState.OPEN.value,
        accepted_shots=0,
        refused_shots=0,
    )
    session.add(row)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="face_enrolment.start",
        entity_type="employee",
        entity_id=employee.id,
        after={"session_id": row.id, "model_id": model_id},
        plant_id=employee.plant_id,
    )
    session.commit()
    return row


# --- Shots --------------------------------------------------------------------------------------


def add_shot(
    session: Session,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    *,
    pose: str,
    image_base64: str,
    engine: FaceEngine,
) -> ShotAnswer:
    row = open_session_of(session, session_id, user_id)
    jpeg = _decode_image(image_base64)
    key = face_key()
    if ready_engine(engine).model_id != row.model_id:
        # The server's model changed during the enrolment: its shots cannot be mixed.
        raise _closed()
    shots = _shots_by_pose(session, row.id)
    straight = shots.get("straight")
    if pose != "straight" and straight is None:
        result = ShotResult("ENROL_POSE_WRONG")  # the straight shot comes first
    else:
        straight_embedding = (
            _open_shot(straight, row.id, key)
            if straight is not None and pose != "straight"
            else None
        )
        limits = _shot_limits(session)
        result = run_face_job(
            engine,
            lambda models: check_shot(
                models,
                jpeg,
                pose,
                limits,
                straight_embedding=straight_embedding,
                straight_nose_ratio=row.straight_nose_ratio,
            ),
        )
    # The picture is not stored anywhere: it is dropped when this request ends.

    if result.accepted and result.embedding is not None:
        _store_shot(session, row, pose, result.embedding, key, replacing=shots.get(pose))
        if pose == "straight" and result.quality is not None:
            row.straight_nose_ratio = result.quality.pitch
        shots_done = len(shots) + (0 if pose in shots else 1)
        row.accepted_shots = shots_done
        done_poses = set(shots) | {pose}
    else:
        row.refused_shots += 1
        shots_done = len(shots)
        done_poses = set(shots)
    # Every shot restarts the idle clock.
    row.expires_at = utc_now() + timedelta(minutes=SESSION_IDLE_MINUTES)
    session.commit()
    next_pose = next((name for name in ENROLMENT_POSES if name not in done_poses), None)
    return ShotAnswer(result=result, shots_done=shots_done, next_pose=next_pose)


def _decode_image(image_base64: str) -> bytes:
    try:
        jpeg = base64.b64decode(image_base64, validate=True)
    except binascii.Error:
        raise ApiError(
            "ENROL_IMAGE_INVALID", "The picture could not be read. Try again.", 422
        ) from None
    if len(jpeg) > MAX_SHOT_BYTES:
        raise ApiError("PAYLOAD_TOO_LARGE", "The picture is too big.", 413)
    return jpeg


def _shot_limits(session: Session) -> ShotLimits:
    return ShotLimits(
        min_face_px=get_int_setting(session, "face_min_face_px"),
        blur_min=float(get_int_setting(session, "face_blur_min")),
        brightness_min=float(get_int_setting(session, "face_brightness_min")),
        antispoof_threshold=get_float_setting(session, "face_antispoof_threshold"),
        consistency_threshold=get_float_setting(session, "face_consistency_threshold"),
    )


def _shots_by_pose(session: Session, session_id: uuid.UUID) -> dict[str, FaceEnrolmentShot]:
    rows = session.scalars(
        select(FaceEnrolmentShot).where(FaceEnrolmentShot.session_id == session_id)
    )
    return {shot.pose: shot for shot in rows}


def _store_shot(
    session: Session,
    row: FaceEnrolmentSession,
    pose: str,
    embedding: np.ndarray,
    key: bytes,
    *,
    replacing: FaceEnrolmentShot | None,
) -> None:
    if replacing is not None:  # a retake of a pose that was accepted before
        session.delete(replacing)
        session.flush()
    sealed = seal_vector(embedding, enrolment_shot_binding(row.id, pose), key)
    session.add(
        FaceEnrolmentShot(
            session_id=row.id, pose=pose, nonce=sealed.nonce, ciphertext=sealed.ciphertext
        )
    )


def _open_shot(shot: FaceEnrolmentShot, session_id: uuid.UUID, key: bytes) -> np.ndarray:
    return open_vector(
        SealedVector(shot.nonce, shot.ciphertext),
        enrolment_shot_binding(session_id, shot.pose),
        key,
    )


# --- Finish and cancel --------------------------------------------------------------------------


def finish(
    session: Session,
    actor: Actor,
    session_id: uuid.UUID,
    *,
    duplicate_override_reason: str | None,
) -> FinishedEnrolment:
    row = open_session_of(session, session_id, actor.actor_id)
    employee = _employee_of(session, row)
    consent = active_consent(session, employee.id)
    if consent is None or consent.id != row.consent_id:
        raise ApiError("CONSENT_REQUIRED", "Record the employee's consent first.", 409)
    key = face_key()
    shots = _shots_by_pose(session, row.id)
    if set(shots) != set(ENROLMENT_POSES):
        raise ApiError("ENROLMENT_INCOMPLETE", "All 5 shots are needed.", 409)

    template_vector = mean_template([_open_shot(shot, row.id, key) for shot in shots.values()])
    duplicates = find_duplicates(session, template_vector, row.model_id, employee.id, key)
    if duplicates and not duplicate_override_reason:
        raise ApiError(
            "FACE_DUPLICATE_FOUND",
            "This face looks like another employee.",
            409,
            {
                "matches": [
                    {
                        "employee_id": str(match.employee_id),
                        "employee_code": match.employee_code,
                        "name": match.name,
                        "plant_code": match.plant_code,
                    }
                    for match in duplicates
                ]
            },
        )

    replaced = delete_active_template(
        session,
        employee,
        kind=TemplateDeleteKind.RE_ENROLLED,
        actor=actor,
        reason=RE_ENROLLED_REASON,
    )
    sealed = seal_vector(template_vector, template_binding(employee.id, row.model_id), key)
    template = FaceTemplate(
        employee_id=employee.id,
        consent_id=consent.id,
        model_id=row.model_id,
        key_id=FACE_KEY_ID,
        nonce=sealed.nonce,
        ciphertext=sealed.ciphertext,
        shot_count=len(shots),
        enrolled_by=actor.actor_id,
        enrolled_at=utc_now(),
        duplicate_override_reason=duplicate_override_reason if duplicates else None,
        duplicate_of_employee_id=duplicates[0].employee_id if duplicates else None,
    )
    session.add(template)
    session.flush()
    row.state = EnrolmentState.FINISHED.value
    row.finished_template_id = template.id
    session.execute(delete(FaceEnrolmentShot).where(FaceEnrolmentShot.session_id == row.id))
    record_audit(
        session,
        actor=actor,
        action="face_template.create",
        entity_type="employee",
        entity_id=employee.id,
        after={
            "template_id": template.id,
            "model_id": template.model_id,
            "shot_count": template.shot_count,
            "replaced_previous": replaced,
        },
        plant_id=employee.plant_id,
    )
    if duplicates:
        record_audit(
            session,
            actor=actor,
            action="face_template.duplicate_override",
            entity_type="employee",
            entity_id=employee.id,
            after={"duplicate_of_employee_id": duplicates[0].employee_id},
            reason=duplicate_override_reason,
            plant_id=employee.plant_id,
        )
    session.commit()
    invalidate_plant_gallery(employee.plant_id)
    return FinishedEnrolment(template=template, replaced_previous=replaced)


def find_duplicates(
    session: Session,
    vector: np.ndarray,
    model_id: str,
    employee_id: uuid.UUID,
    key: bytes,
) -> list[DuplicateMatch]:
    """F-39: active templates of the same model, in every plant, that look like this face."""
    threshold = get_float_setting(session, "face_duplicate_threshold")
    rows = session.execute(
        select(FaceTemplate, Employee, Plant.code)
        .join(Employee, Employee.id == FaceTemplate.employee_id)
        .join(Plant, Plant.id == Employee.plant_id)
        .where(
            FaceTemplate.deleted_at.is_(None),
            FaceTemplate.model_id == model_id,
            FaceTemplate.employee_id != employee_id,
        )
    ).all()
    matches = []
    for template, other, plant_code in rows:
        other_vector = open_template(template, key)
        if other_vector is None:
            continue
        score = cosine(vector, other_vector)
        if score >= threshold:
            matches.append(
                DuplicateMatch(other.id, other.employee_code, other.full_name, plant_code, score)
            )
    matches.sort(key=lambda match: match.score, reverse=True)
    return matches[:MAX_DUPLICATES_SHOWN]


def open_template(template: FaceTemplate, key: bytes) -> np.ndarray | None:
    """The decrypted template, or None (logged) when it cannot be opened, e.g. a wrong key."""
    if template.nonce is None or template.ciphertext is None:
        return None
    try:
        return open_vector(
            SealedVector(template.nonce, template.ciphertext),
            template_binding(template.employee_id, template.model_id, template.key_id),
            key,
        )
    except FaceDecryptionError:
        logger.error(
            "A face template cannot be decrypted (check FACE_TEMPLATE_KEY)",
            extra={"fields": {"template_id": str(template.id)}},
        )
        return None


def cancel(session: Session, actor: Actor, session_id: uuid.UUID) -> None:
    row = _session_of(session, session_id, actor.actor_id)
    if row.state != EnrolmentState.OPEN.value:
        return  # already ended: nothing to do
    cancel_open_session(session, _employee_of(session, row), actor=actor)
    session.commit()


def delete_face_data(session: Session, actor: Actor, employee: Employee, *, reason: str) -> None:
    """ "Delete face data": the template goes AND the consent ends (an erasure request ends the
    consent too, DPDP; decision 0023). The punch method stays face, so the employee shows "Not
    enrolled" and a new enrolment first asks for consent again."""
    if active_template(session, employee.id) is None:
        raise ApiError("FACE_NOT_ENROLLED", "This employee has no face data.", 409)
    cancel_open_session(session, employee, actor=actor)
    delete_active_template(
        session, employee, kind=TemplateDeleteKind.DELETED_BY_ADMIN, actor=actor, reason=reason
    )
    end_consent_after_erasure(session, actor, employee, reason=reason)
    session.commit()
    invalidate_plant_gallery(employee.plant_id)


# --- Loading a session --------------------------------------------------------------------------


def _session_of(
    session: Session, session_id: uuid.UUID, user_id: uuid.UUID | None
) -> FaceEnrolmentSession:
    """Only the Super Admin who started a session may use it; to anyone else it does not exist."""
    row = session.get(FaceEnrolmentSession, session_id)
    if row is None or row.started_by != user_id:
        raise ApiError(
            "ENROLMENT_SESSION_NOT_FOUND", "This enrolment was not found. Start again.", 404
        )
    return row


def open_session_of(
    session: Session, session_id: uuid.UUID, user_id: uuid.UUID | None
) -> FaceEnrolmentSession:
    row = _session_of(session, session_id, user_id)
    if row.state == EnrolmentState.OPEN.value and row.expires_at <= utc_now():
        expire_old_sessions(session, utc_now(), employee_id=row.employee_id)
        session.commit()
        session.refresh(row)
    if row.state == EnrolmentState.EXPIRED.value:
        raise ApiError("ENROLMENT_SESSION_EXPIRED", "Please start the enrolment again.", 409)
    if row.state != EnrolmentState.OPEN.value:
        raise _closed()
    return row


def _employee_of(session: Session, row: FaceEnrolmentSession) -> Employee:
    employee = session.get(Employee, row.employee_id)
    if employee is None:  # cannot happen: employees are never deleted
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee not found.", 404)
    return employee


def _closed() -> ApiError:
    return ApiError("ENROLMENT_SESSION_CLOSED", "This enrolment has ended. Start again.", 409)
