"""Dated attendance rules of a plant: shift rule versions and the weekly off (M5 spec §7 rules 3–4).

A change never rewrites the past: it adds a row that applies from a date (today or later). The
row in force on a date is the one with the latest `effective_from` on or before that date; two
rows with the same date are told apart by `created_at`, the later save wins (decision 0036).

The `shifts` row keeps the rules in force TODAY (M1 screens and the gate device status read it).
A version that starts later is copied into it by `apply_due_rule_versions` (daily job) on its date.
"""

import uuid
from dataclasses import dataclass
from datetime import date, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.org.models import Plant, PlantWeeklyOff, Shift, ShiftRuleVersion

# The fields of a shift that are attendance rules; a change of one of them adds a version.
RULE_FIELDS = ("start_time", "end_time", "grace_min", "half_day_min", "overtime_min_minutes")
MAX_GRACE_MIN = 120
DEFAULT_WEEKLY_OFF = 7  # Sunday (ISO weekday)


@dataclass(frozen=True)
class ShiftRules:
    """The rule values of a shift, without the name or the plant."""

    start_time: time
    end_time: time
    grace_min: int
    half_day_min: int
    overtime_min_minutes: int

    @property
    def crosses_midnight(self) -> bool:
        return self.end_time < self.start_time

    @property
    def length_min(self) -> int:
        return shift_length_minutes(self.start_time, self.end_time)


def shift_length_minutes(start_time: time, end_time: time) -> int:
    """The full day in minutes: a night shift (end before start) ends on the next day."""
    start = timedelta(hours=start_time.hour, minutes=start_time.minute)
    end = timedelta(hours=end_time.hour, minutes=end_time.minute)
    if end <= start:
        end += timedelta(days=1)
    return int((end - start).total_seconds() // 60)


def check_day_limits(rules: ShiftRules) -> None:
    """Half day must be below the full day (the shift length), grace at most 2 hours.

    Checked in code because the shift length depends on both times (spec §7 rule 9).
    """
    if rules.start_time == rules.end_time:
        raise ApiError(
            "SHIFT_TIMES_INVALID", "Start and end cannot be the same.", 422, {"rule": "same"}
        )
    if not 0 <= rules.grace_min <= MAX_GRACE_MIN or not 0 <= rules.half_day_min < rules.length_min:
        raise ApiError(
            "SHIFT_DAY_LIMITS_INVALID",
            "Half day must be shorter than the shift, and grace at most 120 minutes.",
            422,
            {"shift_length_min": rules.length_min},
        )


def rules_of_shift(shift: Shift) -> ShiftRules:
    return ShiftRules(
        start_time=shift.start_time,
        end_time=shift.end_time,
        grace_min=shift.grace_min,
        half_day_min=shift.half_day_min,
        overtime_min_minutes=shift.overtime_min_minutes,
    )


def rules_of_version(version: ShiftRuleVersion) -> ShiftRules:
    return ShiftRules(
        start_time=version.start_time,
        end_time=version.end_time,
        grace_min=version.grace_min,
        half_day_min=version.half_day_min,
        overtime_min_minutes=version.overtime_min_minutes,
    )


def _user_id(actor: Actor) -> uuid.UUID | None:
    return actor.actor_id if actor.actor_type == "user" else None


# --- Shift rule versions --------------------------------------------------------------------


def add_rule_version(
    session: Session, *, actor: Actor, shift: Shift, rules: ShiftRules, effective_from: date
) -> ShiftRuleVersion:
    """Store a rule version and audit it. The caller commits."""
    version = ShiftRuleVersion(
        shift_id=shift.id,
        effective_from=effective_from,
        start_time=rules.start_time,
        end_time=rules.end_time,
        crosses_midnight=rules.crosses_midnight,
        grace_min=rules.grace_min,
        half_day_min=rules.half_day_min,
        overtime_min_minutes=rules.overtime_min_minutes,
        created_by=_user_id(actor),
        created_at=utc_now(),
    )
    session.add(version)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="shift.rules_version_added",
        entity_type="shift",
        entity_id=shift.id,
        after={"effective_from": effective_from, **rules.__dict__},
        plant_id=shift.plant_id,
    )
    return version


def check_rules_date(effective_from: date) -> None:
    if effective_from < today_ist():
        raise ApiError(
            "SHIFT_RULE_DATE_INVALID", "Rules can apply from today or a later date.", 422
        )


def list_rule_versions(session: Session, shift_id: uuid.UUID) -> list[ShiftRuleVersion]:
    """Newest first: by date, then by save time."""
    return list(
        session.scalars(
            select(ShiftRuleVersion)
            .where(ShiftRuleVersion.shift_id == shift_id)
            .order_by(ShiftRuleVersion.effective_from.desc(), ShiftRuleVersion.created_at.desc())
        )
    )


def rule_version_on(session: Session, shift_id: uuid.UUID, day: date) -> ShiftRuleVersion | None:
    """The version in force on `day`, or None before the shift's first version."""
    return session.scalars(
        select(ShiftRuleVersion)
        .where(ShiftRuleVersion.shift_id == shift_id, ShiftRuleVersion.effective_from <= day)
        .order_by(ShiftRuleVersion.effective_from.desc(), ShiftRuleVersion.created_at.desc())
        .limit(1)
    ).first()


def upcoming_rule_version(
    session: Session, shift_id: uuid.UUID, today: date
) -> ShiftRuleVersion | None:
    """The next version that starts after today (the latest save for that date), if any."""
    later = [
        version
        for version in list_rule_versions(session, shift_id)
        if version.effective_from > today
    ]
    if not later:
        return None
    first_date = min(version.effective_from for version in later)
    # list_rule_versions is newest first, so the first match is the latest save for that date.
    return next(version for version in later if version.effective_from == first_date)


def copy_rules_into_shift(shift: Shift, rules: ShiftRules) -> None:
    shift.start_time = rules.start_time
    shift.end_time = rules.end_time
    shift.crosses_midnight = rules.crosses_midnight
    shift.grace_min = rules.grace_min
    shift.half_day_min = rules.half_day_min
    shift.overtime_min_minutes = rules.overtime_min_minutes


def apply_due_rule_versions(session: Session, today: date) -> int:
    """Copy into `shifts` every version that is in force today but not yet copied (daily job).

    Returns how many shifts changed. The caller commits.
    """
    changed = 0
    for shift in session.scalars(select(Shift)):
        version = rule_version_on(session, shift.id, today)
        if version is None:
            continue
        rules = rules_of_version(version)
        if rules != rules_of_shift(shift):
            copy_rules_into_shift(shift, rules)
            changed += 1
    return changed


# --- Weekly off ---------------------------------------------------------------------------------


def add_default_weekly_off(session: Session, *, actor: Actor, plant: Plant) -> None:
    """Every new plant starts with Sunday off from today (spec §6, migration 0019)."""
    session.add(
        PlantWeeklyOff(
            plant_id=plant.id,
            weekday=DEFAULT_WEEKLY_OFF,
            effective_from=today_ist(),
            created_by=_user_id(actor),
            created_at=utc_now(),
        )
    )


def list_weekly_offs(session: Session, plant_id: uuid.UUID) -> list[PlantWeeklyOff]:
    """Newest first: by date, then by save time."""
    return list(
        session.scalars(
            select(PlantWeeklyOff)
            .where(PlantWeeklyOff.plant_id == plant_id)
            .order_by(PlantWeeklyOff.effective_from.desc(), PlantWeeklyOff.created_at.desc())
        )
    )


def weekly_off_on(session: Session, plant_id: uuid.UUID, day: date) -> PlantWeeklyOff | None:
    return session.scalars(
        select(PlantWeeklyOff)
        .where(PlantWeeklyOff.plant_id == plant_id, PlantWeeklyOff.effective_from <= day)
        .order_by(PlantWeeklyOff.effective_from.desc(), PlantWeeklyOff.created_at.desc())
        .limit(1)
    ).first()


def set_weekly_off(
    session: Session, *, actor: Actor, plant: Plant, weekday: int, effective_from: date
) -> PlantWeeklyOff:
    """A new weekly off from today or later, so past registers never change (spec §7 rule 4)."""
    if effective_from < today_ist():
        raise ApiError(
            "WEEKLY_OFF_DATE_INVALID", "The weekly off can change from today or a later date.", 422
        )
    before = weekly_off_on(session, plant.id, effective_from)
    weekly_off = PlantWeeklyOff(
        plant_id=plant.id,
        weekday=weekday,
        effective_from=effective_from,
        created_by=_user_id(actor),
        created_at=utc_now(),
    )
    session.add(weekly_off)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="plant.weekly_off_set",
        entity_type="plant",
        entity_id=plant.id,
        before={"weekday": before.weekday} if before else None,
        after={"weekday": weekday, "effective_from": effective_from},
        plant_id=plant.id,
    )
    session.commit()
    return weekly_off


# --- Attendance start date ----------------------------------------------------------------------


def set_attendance_start_date(
    session: Session, *, actor: Actor, plant: Plant, start_date: date
) -> None:
    """Record the day the plant starts using the attendance devices (spec §7 rule 3).

    The caller commits. Moving it earlier once attendance days exist is refused from slice 2 on,
    when the `attendance_days` table exists.
    """
    if start_date == plant.attendance_start_date:
        return
    before = plant.attendance_start_date
    plant.attendance_start_date = start_date
    record_audit(
        session,
        actor=actor,
        action="plant.attendance_start_set",
        entity_type="plant",
        entity_id=plant.id,
        before={"attendance_start_date": before},
        after={"attendance_start_date": start_date},
        plant_id=plant.id,
    )
