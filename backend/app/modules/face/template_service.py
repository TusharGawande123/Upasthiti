"""Deleting face data: the active template and an open enrolment (spec M3 §7 rules 3, 4, 12).

"Delete" keeps the template row as a record (who, when, why) but removes the face data itself:
the ciphertext and nonce become NULL at once (DPDP data minimisation, decision 0016 item 8).
None of these functions commits: the caller saves them together with the change that caused
them (withdrawal, mark as left, method change), so both happen or neither does.
"""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee
from app.modules.face.models import (
    ConsentChoice,
    EnrolmentState,
    FaceConsent,
    FaceEnrolmentSession,
    FaceEnrolmentShot,
    FaceTemplate,
    TemplateDeleteKind,
    WithdrawKind,
)


def active_template(session: Session, employee_id: uuid.UUID) -> FaceTemplate | None:
    return session.scalar(
        select(FaceTemplate).where(
            FaceTemplate.employee_id == employee_id, FaceTemplate.deleted_at.is_(None)
        )
    )


def delete_active_template(
    session: Session,
    employee: Employee,
    *,
    kind: TemplateDeleteKind,
    actor: Actor,
    reason: str | None,
) -> bool:
    """Remove the employee's working template, if any. Returns whether one was deleted."""
    template = active_template(session, employee.id)
    if template is None:
        return False
    template.deleted_at = utc_now()
    template.deleted_by = actor.actor_id if actor.actor_type == "user" else None  # None = system
    template.delete_kind = kind.value
    template.delete_reason = reason
    template.nonce = None
    template.ciphertext = None
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="face_template.delete",
        entity_type="employee",
        entity_id=employee.id,
        after={"template_id": template.id, "kind": kind.value, "model_id": template.model_id},
        reason=reason,
        plant_id=employee.plant_id,
    )
    return True


def cancel_open_session(session: Session, employee: Employee, *, actor: Actor) -> bool:
    """End the employee's open enrolment, if any, and delete its shot embeddings at once."""
    open_session = session.scalar(
        select(FaceEnrolmentSession).where(
            FaceEnrolmentSession.employee_id == employee.id,
            FaceEnrolmentSession.state == EnrolmentState.OPEN.value,
        )
    )
    if open_session is None:
        return False
    open_session.state = EnrolmentState.CANCELLED.value
    session.execute(
        delete(FaceEnrolmentShot).where(FaceEnrolmentShot.session_id == open_session.id)
    )
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="face_enrolment.cancel",
        entity_type="employee",
        entity_id=employee.id,
        after={"session_id": open_session.id},
        plant_id=employee.plant_id,
    )
    return True


def close_consent_of_leaver(session: Session, employee: Employee) -> None:
    """Marking someone as left closes their consent (by the system: no user, spec §7 rule 3).
    Coming back later brings neither consent nor template back: both are done again."""
    consent = session.scalar(
        select(FaceConsent).where(
            FaceConsent.employee_id == employee.id,
            FaceConsent.choice == ConsentChoice.AGREED.value,
            FaceConsent.withdrawn_at.is_(None),
        )
    )
    if consent is None:
        return
    consent.withdrawn_at = utc_now()
    consent.withdraw_kind = WithdrawKind.LEFT.value
    session.flush()


def end_consent_after_erasure(
    session: Session, actor: Actor, employee: Employee, *, reason: str | None
) -> None:
    """ "Delete face data" ends the active consent as well (decision 0023), recorded as a
    withdrawal by the Super Admin who deleted, with the same reason."""
    consent = session.scalar(
        select(FaceConsent).where(
            FaceConsent.employee_id == employee.id,
            FaceConsent.choice == ConsentChoice.AGREED.value,
            FaceConsent.withdrawn_at.is_(None),
        )
    )
    if consent is None:
        return
    consent.withdrawn_at = utc_now()
    consent.withdrawn_by = actor.actor_id if actor.actor_type == "user" else None
    consent.withdraw_kind = WithdrawKind.WITHDRAWN.value
    consent.withdraw_reason = reason
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="face_consent.withdraw",
        entity_type="employee",
        entity_id=employee.id,
        after={"consent_id": consent.id, "with": "delete_face_data"},
        reason=reason,
        plant_id=employee.plant_id,
    )
