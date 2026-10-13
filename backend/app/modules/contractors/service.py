"""Contractors: one company-wide list, managed by the Super Admin (decision 0005).

A contractor still supplying active workers cannot be switched off.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.service import Actor, record_audit
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee, EmployeeStatus


def snapshot(contractor: Contractor) -> dict[str, object]:
    return {
        "name": contractor.name,
        "contact_name": contractor.contact_name,
        "contact_phone": contractor.contact_phone,
        "is_active": contractor.is_active,
    }


def active_worker_count(session: Session, contractor_id: uuid.UUID) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Employee)
            .where(
                Employee.contractor_id == contractor_id,
                Employee.status == EmployeeStatus.ACTIVE.value,
            )
        )
        or 0
    )


def list_contractors(session: Session, *, is_active: bool | None = None) -> list[Contractor]:
    statement = select(Contractor).order_by(Contractor.name)
    if is_active is not None:
        statement = statement.where(Contractor.is_active == is_active)
    return list(session.scalars(statement))


def get_contractor(session: Session, contractor_id: uuid.UUID) -> Contractor:
    contractor = session.get(Contractor, contractor_id)
    if contractor is None:
        raise ApiError("NOT_FOUND", "Contractor not found.", 404)
    return contractor


def create_contractor(
    session: Session,
    *,
    actor: Actor,
    name: str,
    contact_name: str | None,
    contact_phone: str | None,
) -> Contractor:
    name = name.strip()
    _check_name_free(session, name)
    contractor = Contractor(
        name=name,
        contact_name=(contact_name or "").strip() or None,
        contact_phone=(contact_phone or "").strip() or None,
    )
    session.add(contractor)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="contractor.create",
        entity_type="contractor",
        entity_id=contractor.id,
        after=snapshot(contractor),
    )
    session.commit()
    return contractor


def update_contractor(
    session: Session, *, actor: Actor, contractor: Contractor, changes: dict[str, str | None]
) -> Contractor:
    before = snapshot(contractor)
    new_name = changes.get("name")
    if new_name is not None and new_name.strip().lower() != contractor.name.lower():
        _check_name_free(session, new_name.strip())
    for field_name, value in changes.items():
        setattr(contractor, field_name, (value or "").strip() or None)
    record_audit(
        session,
        actor=actor,
        action="contractor.update",
        entity_type="contractor",
        entity_id=contractor.id,
        before=before,
        after=snapshot(contractor),
    )
    session.commit()
    return contractor


def set_contractor_active(
    session: Session, *, actor: Actor, contractor: Contractor, active: bool, reason: str
) -> Contractor:
    if not active:
        workers = active_worker_count(session, contractor.id)
        if workers:
            raise ApiError(
                "CONTRACTOR_IN_USE",
                "This contractor still supplies active workers.",
                409,
                {"count": workers},
            )
    before = snapshot(contractor)
    contractor.is_active = active
    record_audit(
        session,
        actor=actor,
        action="contractor.reactivate" if active else "contractor.deactivate",
        entity_type="contractor",
        entity_id=contractor.id,
        before=before,
        after=snapshot(contractor),
        reason=reason,
    )
    session.commit()
    return contractor


def _check_name_free(session: Session, name: str) -> None:
    if not name:
        raise ApiError("VALIDATION_FAILED", "A name is needed.", 422)
    if session.scalar(select(Contractor.id).where(func.lower(Contractor.name) == name.lower())):
        raise ApiError("CONTRACTOR_EXISTS", "A contractor with this name exists.", 409)
