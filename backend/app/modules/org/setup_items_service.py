"""Departments, shifts and employee categories of a plant (spec §5.2, §7 rule 9).

Since M5 a change of a shift's times, grace, half day or smallest overtime also adds a dated
rule version (shift_rules_service), so past attendance days keep their rules.

Only the Super Admin changes them (decision 0005). Nothing is deleted: "remove" means
"deactivate", and an item still used by active employees cannot be deactivated.
"""

import uuid
from dataclasses import replace
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus, ShiftAssignment
from app.modules.org.models import Department, EmployeeCategory, Shift
from app.modules.org.shift_rules_service import (
    RULE_FIELDS,
    ShiftRules,
    add_rule_version,
    check_day_limits,
    check_rules_date,
    copy_rules_into_shift,
    rule_version_on,
    rules_of_shift,
    rules_of_version,
)

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
    rules: ShiftRules,
) -> Shift:
    name = name.strip()
    _check_name_free(session, Shift, plant_id, name)
    check_day_limits(rules)
    shift = Shift(plant_id=plant_id, name=name)
    copy_rules_into_shift(shift, rules)
    session.add(shift)
    session.flush()
    add_rule_version(session, actor=actor, shift=shift, rules=rules, effective_from=today_ist())
    _audit(session, actor, shift, "create", before=None)
    session.commit()
    return shift


def update_shift(
    session: Session,
    *,
    actor: Actor,
    shift: Shift,
    changes: dict[str, object],
    rules_effective_from: date | None = None,
) -> Shift:
    """Rename, or change the rules from a date (today or later; default today).

    The new rules are the ones in force on that date with the given fields changed. Only rules in
    force today are copied into the shift row; a later date waits for the daily job.
    """
    before = _snapshot(shift)
    new_name = changes.get("name")
    if isinstance(new_name, str) and new_name.strip().lower() != shift.name.lower():
        _check_name_free(session, Shift, shift.plant_id, new_name.strip())
        shift.name = new_name.strip()

    rule_changes = {key: value for key, value in changes.items() if key in RULE_FIELDS}
    if rule_changes:
        effective_from = rules_effective_from or today_ist()
        check_rules_date(effective_from)
        version_then = rule_version_on(session, shift.id, effective_from)
        rules_then = rules_of_version(version_then) if version_then else rules_of_shift(shift)
        new_rules = replace(rules_then, **rule_changes)
        check_day_limits(new_rules)
        if new_rules != rules_then:
            add_rule_version(
                session, actor=actor, shift=shift, rules=new_rules, effective_from=effective_from
            )
            if effective_from == today_ist():
                copy_rules_into_shift(shift, new_rules)
    _audit(session, actor, shift, "update", before=before)
    session.commit()
    return shift


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
    """Refuse to switch off a shift, category or department active employees still use."""
    active = Employee.status == EmployeeStatus.ACTIVE.value
    if isinstance(item, Shift):
        users = (
            select(func.count())
            .select_from(ShiftAssignment)
            .join(Employee, Employee.id == ShiftAssignment.employee_id)
            .where(ShiftAssignment.shift_id == item.id, ShiftAssignment.to_date.is_(None), active)
        )
        code = "SHIFT_IN_USE"
    elif isinstance(item, EmployeeCategory):
        users = (
            select(func.count())
            .select_from(Employee)
            .where(Employee.category_id == item.id, active)
        )
        code = "CATEGORY_IN_USE"
    else:
        users = (
            select(func.count())
            .select_from(Employee)
            .where(Employee.department_id == item.id, active)
        )
        code = "DEPARTMENT_IN_USE"
    count = session.scalar(users) or 0
    if count:
        raise ApiError(
            code, "Active employees still use this. Move them first.", 409, {"count": count}
        )


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
            "overtime_min_minutes": item.overtime_min_minutes,
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
