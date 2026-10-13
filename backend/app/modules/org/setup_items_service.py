"""Departments, shifts and employee categories of a plant (spec §5.2, §7 rule 9).

Only the Super Admin changes them (decision 0005). Nothing is deleted: "remove" means
"deactivate", and an item still used by active employees cannot be deactivated (that
check is added together with the employees table in slice D).
"""

import uuid
from datetime import time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.service import Actor, record_audit
from app.modules.org.models import Department, EmployeeCategory, Shift

SetupItem = Department | Shift | EmployeeCategory


def list_items[ItemType: SetupItem](
    session: Session, model: type[ItemType], plant_id: uuid.UUID
) -> list[ItemType]:
    return list(
        session.scalars(
            select(model)
            .where(model.plant_id == plant_id)
            .order_by(model.is_active.desc(), model.name)
        )
    )


def get_item[ItemType: SetupItem](
    session: Session, model: type[ItemType], item_id: uuid.UUID
) -> ItemType:
    item = session.get(model, item_id)
    if item is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return item


# --- Departments and categories (a name only) ------------------------------------------------


def create_named_item(
    session: Session,
    *,
    actor: Actor,
    model: type[Department] | type[EmployeeCategory],
    plant_id: uuid.UUID,
    name: str,
) -> Department | EmployeeCategory:
    name = name.strip()
    _check_name_free(session, model, plant_id, name)
    item = model(plant_id=plant_id, name=name)
    session.add(item)
    session.flush()
    _audit(session, actor, item, "create", before=None)
    session.commit()
    return item


def rename_item(
    session: Session, *, actor: Actor, item: Department | EmployeeCategory, name: str
) -> Department | EmployeeCategory:
    name = name.strip()
    before = _snapshot(item)
    if name.lower() != item.name.lower():
        _check_name_free(session, type(item), item.plant_id, name)
    item.name = name
    _audit(session, actor, item, "update", before=before)
    session.commit()
    return item


# --- Shifts -----------------------------------------------------------------------------------


def create_shift(
    session: Session,
    *,
    actor: Actor,
    plant_id: uuid.UUID,
    name: str,
    start_time: time,
    end_time: time,
    grace_min: int,
    half_day_min: int,
    ot_after_min: int,
) -> Shift:
    name = name.strip()
    _check_name_free(session, Shift, plant_id, name)
    shift = Shift(
        plant_id=plant_id,
        name=name,
        start_time=start_time,
        end_time=end_time,
        crosses_midnight=shift_crosses_midnight(start_time, end_time),
        grace_min=grace_min,
        half_day_min=half_day_min,
        ot_after_min=ot_after_min,
    )
    session.add(shift)
    session.flush()
    _audit(session, actor, shift, "create", before=None)
    session.commit()
    return shift


def update_shift(
    session: Session, *, actor: Actor, shift: Shift, changes: dict[str, object]
) -> Shift:
    """Apply the given fields. Past attendance keeps its computed values (spec §7 rule 9)."""
    before = _snapshot(shift)
    new_name = changes.get("name")
    if isinstance(new_name, str) and new_name.strip().lower() != shift.name.lower():
        _check_name_free(session, Shift, shift.plant_id, new_name.strip())
    for field_name, value in changes.items():
        setattr(shift, field_name, value.strip() if isinstance(value, str) else value)
    shift.crosses_midnight = shift_crosses_midnight(shift.start_time, shift.end_time)
    _audit(session, actor, shift, "update", before=before)
    session.commit()
    return shift


def shift_crosses_midnight(start_time: time, end_time: time) -> bool:
    """A shift that ends at or before its start time ends on the next day (night shift)."""
    if start_time == end_time:
        raise ApiError(
            "SHIFT_TIMES_INVALID", "Start and end cannot be the same.", 422, {"rule": "same"}
        )
    return end_time < start_time


# --- Switching off and on -----------------------------------------------------------------------


def set_item_active(
    session: Session, *, actor: Actor, item: SetupItem, active: bool, reason: str
) -> SetupItem:
    if not active:
        _check_not_in_use(session, item)
    before = _snapshot(item)
    item.is_active = active
    _audit(session, actor, item, "reactivate" if active else "deactivate", before, reason)
    session.commit()
    return item


def _check_not_in_use(session: Session, item: SetupItem) -> None:
    # Employees arrive in slice D; until then nothing can be in use.
    return None


def _check_name_free(
    session: Session, model: type[SetupItem], plant_id: uuid.UUID, name: str
) -> None:
    if not name:
        raise ApiError("VALIDATION_FAILED", "A name is needed.", 422)
    taken = session.scalar(
        select(model.id).where(model.plant_id == plant_id, func.lower(model.name) == name.lower())
    )
    if taken:
        code = {
            Department: "DEPARTMENT_EXISTS",
            Shift: "SHIFT_EXISTS",
            EmployeeCategory: "CATEGORY_EXISTS",
        }[model]
        raise ApiError(code, "This name is already used at this plant.", 409)


ENTITY_TYPES = {Department: "department", Shift: "shift", EmployeeCategory: "category"}


def _snapshot(item: SetupItem) -> dict[str, object]:
    values: dict[str, object] = {"name": item.name, "is_active": item.is_active}
    if isinstance(item, Shift):
        values |= {
            "start_time": item.start_time,
            "end_time": item.end_time,
            "crosses_midnight": item.crosses_midnight,
            "grace_min": item.grace_min,
            "half_day_min": item.half_day_min,
            "ot_after_min": item.ot_after_min,
        }
    return values


def _audit(
    session: Session,
    actor: Actor,
    item: SetupItem,
    verb: str,
    before: dict[str, object] | None,
    reason: str | None = None,
) -> None:
    entity_type = ENTITY_TYPES[type(item)]
    record_audit(
        session,
        actor=actor,
        action=f"{entity_type}.{verb}",
        entity_type=entity_type,
        entity_id=item.id,
        before=before,
        after=_snapshot(item),
        reason=reason,
        plant_id=item.plant_id,
    )
