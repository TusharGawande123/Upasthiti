"""Reading punches for the admin punch log (spec M2 §5.3, §4.10).

A punch belongs to the plant of the kiosk where it was made, so the plant filter and a Plant
Head's scope both use `punches.plant_id` (the kiosk's plant). A day is an IST calendar day.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.core.time import IST
from app.modules.employees.models import Employee
from app.modules.punches.models import (
    Direction,
    MatchMode,
    Punch,
    PunchDecision,
    PunchReview,
    PunchSnapshot,
    ReviewAction,
    SnapshotState,
)

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
    # M3 (spec §5.5)
    method: str | None = None
    match_mode: str | None = None
    asked_for_code: bool = False
    no_face_photo: bool = False  # Super Admin only (F-30)
    # M4 (spec §5.4)
    flagged: bool = False
    was_offline: bool = False
    review_state: str | None = None  # to_check / confirmed / not_accepted / approved


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
        # M4: a day means the punch time (a punch saved offline belongs to the day it was made).
        .where(Punch.punch_time >= start, Punch.punch_time < end)
        .order_by(Punch.punch_time.desc(), Punch.id)
    )
    if only_plant_ids is not None:
        statement = statement.where(Punch.plant_id.in_(only_plant_ids))
    for column, value in (
        (Punch.plant_id, filters.plant_id),
        (Punch.decision, filters.decision),
        (Punch.kiosk_id, filters.kiosk_id),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if filters.employee_id is not None:
        # The punches of a person, and the rejected punches an approval counts for them.
        statement = statement.where(
            or_(
                Punch.employee_id == filters.employee_id,
                _approved_for(filters.employee_id),
            )
        )
    if only_plant_ids is not None and filters.employee_id is not None:
        # Rows of other plants' people are hidden in the log, so they must not be findable
        # by their id either (the answer "no rows" would confirm the person exists).
        statement = statement.where(
            exists().where(
                Employee.id == filters.employee_id, Employee.plant_id.in_(only_plant_ids)
            )
        )
    if filters.reason_code:
        statement = statement.where(Punch.reason_codes.contains([filters.reason_code]))
    if filters.method:
        statement = statement.where(Punch.method == filters.method)
    if filters.match_mode:
        statement = statement.where(Punch.match_mode == filters.match_mode)
    if filters.asked_for_code:
        statement = statement.where(Punch.decision == PunchDecision.NEEDS_CODE.value)
    if filters.no_face_photo:
        statement = statement.where(
            exists().where(PunchSnapshot.punch_id == Punch.id, PunchSnapshot.face_found.is_(False))
        )
    if filters.flagged:
        statement = statement.where(Punch.decision == PunchDecision.FLAGGED.value)
    if filters.was_offline:
        statement = statement.where(Punch.was_offline.is_(True))
    if filters.review_state:
        statement = _by_review_state(statement, filters.review_state)
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


def _approved_for(employee_id: uuid.UUID):  # noqa: ANN202 (a SQL condition)
    """The punch's latest review approved it for this person (counting.py counts it for them)."""
    latest = aliased(PunchReview, name="approved_filter")
    newer = aliased(PunchReview, name="approved_newer")
    return exists().where(
        latest.punch_id == Punch.id,
        latest.action == ReviewAction.APPROVED.value,
        latest.employee_id == employee_id,
        ~exists().where(newer.supersedes_review_id == latest.id),
    )


def _by_review_state(statement: Select[Punch], state: str) -> Select[Punch]:
    """Flagged punches by what the Super Admin decided (the latest review of each punch)."""
    latest = aliased(PunchReview, name="review_filter")
    newer = aliased(PunchReview, name="review_newer")
    has_latest = exists().where(
        latest.punch_id == Punch.id, ~exists().where(newer.supersedes_review_id == latest.id)
    )

    def latest_is(action: str):  # noqa: ANN202 (a SQL condition)
        return exists().where(
            latest.punch_id == Punch.id,
            latest.action == action,
            ~exists().where(newer.supersedes_review_id == latest.id),
        )

    if state == "to_check":
        return statement.where(Punch.decision == PunchDecision.FLAGGED.value, ~has_latest)
    if state == "confirmed":
        return statement.where(latest_is(ReviewAction.CONFIRMED.value))
    if state == "not_accepted":
        return statement.where(latest_is(ReviewAction.NOT_ACCEPTED.value))
    if state == "approved":
        return statement.where(latest_is(ReviewAction.APPROVED.value))
    return statement


@dataclass(frozen=True)
class DaySummary:
    accepted_in: int
    accepted_out: int
    rejected: int
    dark_photos: int
    rejected_by_reason: dict[str, int]
    face_accepted: int
    code_accepted: int
    asked_for_code: int
    no_face_photos: int
    flagged: int = 0
    offline: int = 0
    to_check: int = 0


def day_summary(session: Session, statement: Select[Punch]) -> DaySummary:
    matching = statement.order_by(None).subquery()
    counts = session.execute(
        select(matching.c.decision, matching.c.direction, func.count()).group_by(
            matching.c.decision, matching.c.direction
        )
    ).all()
    by_kind = {(decision, direction): number for decision, direction, number in counts}
    accepted = PunchDecision.ACCEPTED.value
    flagged = PunchDecision.FLAGGED.value
    needs_code = PunchDecision.NEEDS_CODE.value
    # "Asked for code" is not a rejection: the person may still be accepted by the code. A flagged
    # punch counts as IN or OUT like an accepted one (it also shows in the "flagged" chip).
    rejected = sum(
        n for (decision, _), n in by_kind.items() if decision not in (accepted, flagged, needs_code)
    )
    counted = {
        direction: by_kind.get((accepted, direction), 0) + by_kind.get((flagged, direction), 0)
        for direction in (Direction.IN.value, Direction.OUT.value)
    }
    flagged_total = sum(n for (decision, _), n in by_kind.items() if decision == flagged)
    offline_total = session.scalar(
        select(func.count()).select_from(matching).where(matching.c.was_offline.is_(True))
    )
    to_check = session.scalar(
        select(func.count())
        .select_from(Punch)
        .where(
            Punch.id.in_(select(matching.c.id)),
            Punch.decision == flagged,
            ~exists().where(PunchReview.punch_id == Punch.id),
        )
    )
    # The first reason of each rejection, worked out once, then counted per reason.
    first_reasons = (
        select(matching.c.reason_codes[1].label("reason"))
        .where(matching.c.decision.not_in([accepted, flagged, needs_code]))
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
    face_counts = dict(
        session.execute(
            select(matching.c.match_mode, func.count())
            .where(matching.c.decision.in_([accepted, flagged]), matching.c.match_mode.is_not(None))
            .group_by(matching.c.match_mode)
        ).all()
    )
    no_face = session.scalar(
        select(func.count())
        .select_from(PunchSnapshot)
        .where(
            PunchSnapshot.punch_id.in_(select(matching.c.id)), PunchSnapshot.face_found.is_(False)
        )
    )
    return DaySummary(
        face_accepted=face_counts.get(MatchMode.ONE_TO_MANY.value, 0),
        code_accepted=face_counts.get(MatchMode.CODE.value, 0),
        asked_for_code=sum(n for (decision, _), n in by_kind.items() if decision == needs_code),
        no_face_photos=no_face or 0,
        accepted_in=counted[Direction.IN.value],
        accepted_out=counted[Direction.OUT.value],
        flagged=flagged_total,
        offline=offline_total or 0,
        to_check=to_check or 0,
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


def has_snapshot(session: Session, punch_id: uuid.UUID) -> bool:
    return (
        session.scalar(select(PunchSnapshot.id).where(PunchSnapshot.punch_id == punch_id))
        is not None
    )
