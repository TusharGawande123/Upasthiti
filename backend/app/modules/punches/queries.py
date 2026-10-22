"""Reading punches for the admin punch log (spec M2 §5.3, §4.10).

A punch belongs to the plant of the kiosk where it was made, so the plant filter and a Plant
Head's scope both use `punches.plant_id` (the kiosk's plant). A day is an IST calendar day.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import IST
from app.modules.employees.models import Employee
from app.modules.punches.models import Direction, Punch, PunchDecision, PunchSnapshot, SnapshotState

COMPARE_HOW_MANY = 3


@dataclass(frozen=True)
class PunchFilters:
    day: date
    plant_id: uuid.UUID | None = None
    decision: str | None = None
    kiosk_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    reason_code: str | None = None
    dark_only: bool = False
    search: str | None = None


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """00:00 to 24:00 of an IST day, as aware datetimes (the database compares in UTC)."""
    start = datetime.combine(day, time.min, tzinfo=IST)
    return start, start + timedelta(days=1)


def punches_statement(
    filters: PunchFilters, only_plant_ids: frozenset[uuid.UUID] | None
) -> Select[Punch]:
    """All punches matching the filters, newest first."""
    start, end = day_bounds(filters.day)
    statement = (
        select(Punch)
        .where(Punch.server_received_at >= start, Punch.server_received_at < end)
        .order_by(Punch.server_received_at.desc(), Punch.id)
    )
    if only_plant_ids is not None:
        statement = statement.where(Punch.plant_id.in_(only_plant_ids))
    for column, value in (
        (Punch.plant_id, filters.plant_id),
        (Punch.decision, filters.decision),
        (Punch.kiosk_id, filters.kiosk_id),
        (Punch.employee_id, filters.employee_id),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if only_plant_ids is not None and filters.employee_id is not None:
        # Rows of other plants' people are hidden in the log, so they must not be findable
        # by their id either (the answer "no rows" would confirm the person exists).
        statement = statement.where(
            Punch.employee_id.in_(select(Employee.id).where(Employee.plant_id.in_(only_plant_ids)))
        )
    if filters.reason_code:
        statement = statement.where(Punch.reason_codes.contains([filters.reason_code]))
    if filters.dark_only:
        statement = statement.join(PunchSnapshot, PunchSnapshot.punch_id == Punch.id).where(
            PunchSnapshot.is_dark.is_(True)
        )
    if filters.search:
        cleaned = filters.search.strip()
        statement = statement.join(Employee, Employee.id == Punch.employee_id).where(
            or_(
                Employee.employee_code.startswith(cleaned.upper()),
                func.lower(Employee.full_name).contains(cleaned.lower()),
            )
        )
        if only_plant_ids is not None:
            # Same reason as above: a search must not reveal who the hidden rows belong to.
            statement = statement.where(Employee.plant_id.in_(only_plant_ids))
    return statement


@dataclass(frozen=True)
class DaySummary:
    accepted_in: int
    accepted_out: int
    rejected: int
    dark_photos: int
    rejected_by_reason: dict[str, int]


def day_summary(session: Session, statement: Select[Punch]) -> DaySummary:
    matching = statement.order_by(None).subquery()
    counts = session.execute(
        select(matching.c.decision, matching.c.direction, func.count()).group_by(
            matching.c.decision, matching.c.direction
        )
    ).all()
    by_kind = {(decision, direction): number for decision, direction, number in counts}
    accepted = PunchDecision.ACCEPTED.value
    rejected = sum(n for (decision, _), n in by_kind.items() if decision != accepted)
    # The first reason of each rejection, worked out once, then counted per reason.
    first_reasons = (
        select(matching.c.reason_codes[1].label("reason"))
        .where(matching.c.decision != accepted)
        .subquery()
    )
    reasons = session.execute(
        select(first_reasons.c.reason, func.count()).group_by(first_reasons.c.reason)
    ).all()
    dark = session.scalar(
        select(func.count())
        .select_from(PunchSnapshot)
        .where(PunchSnapshot.punch_id.in_(select(matching.c.id)), PunchSnapshot.is_dark.is_(True))
    )
    return DaySummary(
        accepted_in=by_kind.get((accepted, Direction.IN.value), 0),
        accepted_out=by_kind.get((accepted, Direction.OUT.value), 0),
        rejected=rejected,
        dark_photos=dark or 0,
        rejected_by_reason={code: number for code, number in reasons if code},
    )


def get_punch_in_scope(
    session: Session, punch_id: uuid.UUID, only_plant_ids: frozenset[uuid.UUID] | None
) -> Punch:
    """A punch of another plant looks like it does not exist (no id leaks)."""
    punch = session.get(Punch, punch_id)
    if punch is None or (only_plant_ids is not None and punch.plant_id not in only_plant_ids):
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return punch


def earlier_photos_of_card(session: Session, punch: Punch) -> list[Punch]:
    """The same card's last punches before this one that still have a stored photo (F-29)."""
    if punch.qr_credential_id is None:
        return []
    return list(
        session.scalars(
            select(Punch)
            .join(PunchSnapshot, PunchSnapshot.punch_id == Punch.id)
            .where(
                Punch.qr_credential_id == punch.qr_credential_id,
                Punch.server_received_at < punch.server_received_at,
                PunchSnapshot.state == SnapshotState.STORED.value,
            )
            .order_by(Punch.server_received_at.desc())
            .limit(COMPARE_HOW_MANY)
        )
    )
