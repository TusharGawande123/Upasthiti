"""Recording, declining and withdrawing face consent (spec M3 §7 rules 2 and 3, AC-3, AC-4, AC-20).

Consent comes before any face data: without an active "agreed" consent no enrolment can start.
"No, I prefer a QR card" and a withdrawal both switch the employee to QR at once, as a direct
Super Admin change with its own audit entry. A withdrawal also deletes the template and any
open enrolment in the same transaction, so face data never outlives the consent.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.employees.operations import snapshot
from app.modules.face.consent_texts import consent_text
from app.modules.face.gallery_cache import invalidate_plant_gallery
from app.modules.face.models import ConsentChoice, FaceConsent, TemplateDeleteKind, WithdrawKind
from app.modules.face.template_service import cancel_open_session, delete_active_template

DECLINED_REASON = "Chose QR card on the consent screen"
WITHDRAWN_REASON = "Face consent withdrawn"


@dataclass(frozen=True)
class WithdrawResult:
    consent: FaceConsent
    template_deleted: bool


def active_consent(session: Session, employee_id: uuid.UUID) -> FaceConsent | None:
    return session.scalar(
        select(FaceConsent).where(
            FaceConsent.employee_id == employee_id,
            FaceConsent.choice == ConsentChoice.AGREED.value,
            FaceConsent.withdrawn_at.is_(None),
        )
    )


def record_consent(
    session: Session,
    actor: Actor,
    employee: Employee,
    *,
    text_version: str,
    language: str,
    choice: ConsentChoice,
    explained_language: str | None,
) -> FaceConsent:
    if employee.status == EmployeeStatus.LEFT.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    shown = consent_text(session, text_version, language)
    if active_consent(session, employee.id) is not None:
        raise _already_given()

    consent = FaceConsent(
        employee_id=employee.id,
        choice=choice.value,
        text_version=shown.version,
        language=shown.language,
        explained_language=explained_language,
        text_sha256=shown.text_sha256,
        given_at=utc_now(),
        recorded_by=actor.actor_id,
    )
    try:
        with session.begin_nested():
            session.add(consent)
            session.flush()  # the one-active-consent index is checked here
    except IntegrityError:
        raise _already_given() from None
    action = "face_consent.give" if choice is ConsentChoice.AGREED else "face_consent.decline"
    record_audit(
        session,
        actor=actor,
        action=action,
        entity_type="employee",
        entity_id=employee.id,
        after={
            "consent_id": consent.id,
            "text_version": consent.text_version,
            "language": consent.language,
            "explained_language": explained_language,
            "text_sha256": consent.text_sha256,
        },
        plant_id=employee.plant_id,
    )
    if choice is ConsentChoice.DECLINED:
        _switch_to_qr(session, actor, employee, DECLINED_REASON)
    session.commit()
    invalidate_plant_gallery(employee.plant_id)
    return consent


def withdraw_consent(
    session: Session, actor: Actor, employee: Employee, *, reason: str | None
) -> WithdrawResult:
    consent = active_consent(session, employee.id)
    if consent is None:
        raise ApiError("CONSENT_NOT_ACTIVE", "There is no active consent to withdraw.", 409)

    # All in one transaction: the consent ends, the face data goes, the method becomes QR.
    consent.withdrawn_at = utc_now()
    consent.withdrawn_by = actor.actor_id
    consent.withdraw_kind = WithdrawKind.WITHDRAWN.value
    consent.withdraw_reason = reason
    record_audit(
        session,
        actor=actor,
        action="face_consent.withdraw",
        entity_type="employee",
        entity_id=employee.id,
        after={"consent_id": consent.id},
        reason=reason,
        plant_id=employee.plant_id,
    )
    deleted = delete_active_template(
        session, employee, kind=TemplateDeleteKind.CONSENT_WITHDRAWN, actor=actor, reason=reason
    )
    cancel_open_session(session, employee, actor=actor)
    _switch_to_qr(session, actor, employee, WITHDRAWN_REASON)
    session.commit()
    invalidate_plant_gallery(employee.plant_id)
    return WithdrawResult(consent=consent, template_deleted=deleted)


def _switch_to_qr(session: Session, actor: Actor, employee: Employee, reason: str) -> None:
    """A direct Super Admin change (no approval request): the employee asked for a card."""
    if employee.punch_method == PunchMethod.QR.value:
        return
    before = snapshot(session, employee)
    employee.punch_method = PunchMethod.QR.value
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="employee.update",
        entity_type="employee",
        entity_id=employee.id,
        before=before,
        after=snapshot(session, employee),
        reason=reason,
        plant_id=employee.plant_id,
    )


def _already_given() -> ApiError:
    return ApiError("CONSENT_ALREADY_GIVEN", "Consent is already recorded.", 409)
