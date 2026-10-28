"""Which punches count as an IN or an OUT (M4 spec section 7 rule 6, decision 0025 items 3 and 4).

One place decides it, so the IN/OUT rule, the flag rules, the punch log and (later) M5 agree:
  accepted                         counts
  flagged                          counts, unless its latest review is "not accepted"
  rejected                         counts only when its latest review "approved" it, with the
                                   direction and the employee of that review
  needs_code                       never counts
A review only changes later decisions: a punch already decided keeps its stored direction.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, and_, case, exists, or_, select
from sqlalchemy.orm import Session, aliased

from app.modules.punches.models import Punch, PunchDecision, PunchReview, ReviewAction

_latest = aliased(PunchReview, name="latest_review")
_newer = aliased(PunchReview, name="newer_review")

# The latest review is the one that no other review replaces.
_is_latest_review = ~exists().where(_newer.supersedes_review_id == _latest.id)

_counts: ColumnElement[bool] = or_(
    and_(
        Punch.decision.in_([PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value]),
        or_(_latest.id.is_(None), _latest.action != ReviewAction.NOT_ACCEPTED.value),
    ),
    and_(
        Punch.decision == PunchDecision.REJECTED.value,
        _latest.action == ReviewAction.APPROVED.value,
    ),
)
_counted_direction = case(
    (_latest.action == ReviewAction.APPROVED.value, _latest.direction), else_=Punch.direction
)


@dataclass(frozen=True)
class CountedPunch:
    punch: Punch
    direction: str  # "in" or "out"

    @property
    def punch_time(self) -> datetime:
        return self.punch.punch_time


def _counted_statement(employee_id: uuid.UUID):  # a SELECT of (Punch, direction)
    belongs_to_employee = or_(
        Punch.employee_id == employee_id,
        and_(
            _latest.action == ReviewAction.APPROVED.value,
            _latest.employee_id == employee_id,
        ),
    )
    return (
        select(Punch, _counted_direction)
        .outerjoin(_latest, and_(_latest.punch_id == Punch.id, _is_latest_review))
        .where(_counts, belongs_to_employee)
    )


def last_counted_before(
    session: Session, employee_id: uuid.UUID, moment: datetime
) -> CountedPunch | None:
    """The employee's latest counted punch strictly before `moment`."""
    row = session.execute(
        _counted_statement(employee_id)
        .where(Punch.punch_time < moment)
        .order_by(Punch.punch_time.desc())
        .limit(1)
    ).first()
    return CountedPunch(row[0], row[1]) if row else None


def first_counted_after(
    session: Session, employee_id: uuid.UUID, moment: datetime
) -> CountedPunch | None:
    """The employee's earliest counted punch strictly after `moment` (only possible when an
    offline punch arrives after newer punches were already decided)."""
    row = session.execute(
        _counted_statement(employee_id)
        .where(Punch.punch_time > moment)
        .order_by(Punch.punch_time.asc())
        .limit(1)
    ).first()
    return CountedPunch(row[0], row[1]) if row else None


def counted_between(
    session: Session, employee_id: uuid.UUID, start: datetime, end: datetime
) -> list[CountedPunch]:
    """The employee's counted punches with start <= punch time <= end, oldest first."""
    rows = session.execute(
        _counted_statement(employee_id)
        .where(Punch.punch_time >= start, Punch.punch_time <= end)
        .order_by(Punch.punch_time.asc())
    ).all()
    return [CountedPunch(row[0], row[1]) for row in rows]


def latest_reviews(
    session: Session, punch_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, PunchReview]:
    """The latest review of each punch that has one, in one query (for a page of the log)."""
    if not punch_ids:
        return {}
    rows = session.scalars(
        select(_latest).where(_latest.punch_id.in_(punch_ids), _is_latest_review)
    )
    return {review.punch_id: review for review in rows}


def review_state(punch: Punch, review: PunchReview | None) -> str | None:
    """The review mark of a flagged or rejected punch: to_check / confirmed / not_accepted /
    approved. Accepted and needs-code punches have none."""
    if punch.decision == PunchDecision.FLAGGED.value:
        if review is None:
            return "to_check"
        return "not_accepted" if review.action == ReviewAction.NOT_ACCEPTED.value else "confirmed"
    if punch.decision == PunchDecision.REJECTED.value and review is not None:
        return "approved"
    return None


def latest_review(session: Session, punch_id: uuid.UUID) -> PunchReview | None:
    return session.scalar(
        select(_latest).where(_latest.punch_id == punch_id, _is_latest_review).limit(1)
    )
