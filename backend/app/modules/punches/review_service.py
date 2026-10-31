"""The Super Admin's "Needs review" work (spec M4 §4.8, §5.3, §7 rules 6, 7 and 20).

Three lists:
  to check   flagged punches nobody has reviewed yet (they already count as IN/OUT)
  rejected   rejected punches nobody has reviewed yet; "already punched" repeat scans
             (COOLDOWN_ACTIVE) are hidden unless asked for; "asked for code" rows never show
  reviewed   punches with a review, newest review first

A review is a new `punch_reviews` row; the punch row itself is never changed. Changing a review
adds another row that supersedes the one the screen showed. What a review means for IN/OUT is
decided in one place only: punches/counting.py.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.core.time import IST, to_ist, today_ist, utc_now
from app.modules.attendance.service import mark_punch_stale
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee
from app.modules.kiosks.location_check import geofence_at
from app.modules.kiosks.models import KioskDevice, KioskStatus
from app.modules.kiosks.status_service import offline_minutes_in_shifts
from app.modules.org.geofence import distance_between_m, geofence_centre
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Geofence, Plant
from app.modules.punches import presenter
from app.modules.punches.counting import (
    counted_between,
    last_counted_before,
    latest_review,
    latest_reviews,
)
from app.modules.punches.models import Direction, Punch, PunchDecision, PunchReview, ReviewAction
from app.modules.punches.review_schemas import (
    ContextFence,
    DigestPlace,
    DigestPlant,
    NearbyCounted,
    RelatedPunch,
    ReviewContext,
    ReviewDigest,
    ReviewHint,
    ReviewListItem,
    ReviewPunch,
    ReviewRequest,
    ReviewSummary,
    Suggestion,
)
from app.modules.punches.schemas import PunchLogEmployee, PunchReviewOut
from app.modules.settings.service import get_int_setting

MAX_RANGE_DAYS = 62
DEFAULT_RANGE_DAYS = 7
DIGEST_DAYS_BACK = 7
HINT_DAYS = 7
CARD_TWO_DEVICES_HINT = 2  # spec §7 rule 20: a fixed number, not a setting

COOLDOWN = "COOLDOWN_ACTIVE"
RELATED_FLAGS = {"IMPOSSIBLE_TRAVEL", "TWO_DEVICES_SOON", "SYNC_ORDER_CONFLICT"}

# What the request says -> what the review row stores.
ACTIONS = {
    "confirm": ReviewAction.CONFIRMED.value,
    "not_accepted": ReviewAction.NOT_ACCEPTED.value,
    "approve": ReviewAction.APPROVED.value,
}

_latest = aliased(PunchReview, name="list_latest_review")
_newer = aliased(PunchReview, name="list_newer_review")
_has_review = exists().where(PunchReview.punch_id == Punch.id)
# The person a punch is about: the matched employee, else the one whose code was typed.
_named_person = func.coalesce(Punch.employee_id, Punch.claimed_employee_id)
_first_code = Punch.reason_codes[1]  # PostgreSQL arrays start at 1


def _not_allowed(message: str) -> ApiError:
    return ApiError("REVIEW_NOT_ALLOWED", message, 409)


# --- The lists -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewFilters:
    tab: str  # to_check / rejected / reviewed
    date_from: date
    date_to: date
    plant_id: uuid.UUID | None = None
    kiosk_id: uuid.UUID | None = None
    code: str | None = None
    method: str | None = None
    was_offline: bool | None = None
    employee_id: uuid.UUID | None = None
    search: str | None = None
    names_employee: bool | None = None
    include_cooldown: bool = False


def default_dates() -> tuple[date, date]:
    """The last 7 IST days, today included."""
    today = today_ist()
    return today - timedelta(days=DEFAULT_RANGE_DAYS - 1), today


def check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from or (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(
            "VALIDATION_FAILED",
            f"Choose at most {MAX_RANGE_DAYS} days, the start before the end.",
            422,
            {"fields": {"date_from": "range"}},
        )


def _ist_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    start = datetime.combine(date_from, time.min, tzinfo=IST)
    return start, datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=IST)


def _hide_repeat_scans(statement: Select) -> Select:
    # A rejected row always has its rejection code first (spec §7 rule 2).
    return statement.where(func.coalesce(_first_code, "") != COOLDOWN)


def review_list_statement(filters: ReviewFilters) -> Select:
    """The punches of one tab that match the filters. Super Admin only: every plant."""
    start, end = _ist_bounds(filters.date_from, filters.date_to)
    statement = select(Punch).where(Punch.punch_time >= start, Punch.punch_time < end)
    if filters.tab == "to_check":
        statement = statement.where(
            Punch.decision == PunchDecision.FLAGGED.value, ~_has_review
        ).order_by(Punch.punch_time.desc(), Punch.id)
    elif filters.tab == "rejected":
        statement = statement.where(Punch.decision == PunchDecision.REJECTED.value, ~_has_review)
        if not filters.include_cooldown:
            statement = _hide_repeat_scans(statement)
        statement = statement.order_by(Punch.punch_time.desc(), Punch.id)
    else:  # reviewed: newest review first
        statement = statement.join(
            _latest,
            and_(
                _latest.punch_id == Punch.id,
                ~exists().where(_newer.supersedes_review_id == _latest.id),
            ),
        ).order_by(_latest.reviewed_at.desc(), Punch.id)
    return _apply_filters(statement, filters)


def _apply_filters(statement: Select, filters: ReviewFilters) -> Select:
    for column, value in (
        (Punch.plant_id, filters.plant_id),
        (Punch.kiosk_id, filters.kiosk_id),
        (Punch.method, filters.method),
        (Punch.was_offline, filters.was_offline),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if filters.code:
        statement = statement.where(Punch.reason_codes.contains([filters.code]))
    if filters.employee_id is not None:
        statement = statement.where(_named_person == filters.employee_id)
    if filters.names_employee is not None:
        statement = statement.where(
            _named_person.is_not(None) if filters.names_employee else _named_person.is_(None)
        )
    if filters.search:
        cleaned = filters.search.strip()
        statement = statement.join(Employee, Employee.id == _named_person).where(
            or_(
                Employee.employee_code.startswith(cleaned.upper()),
                func.lower(Employee.full_name).contains(cleaned.lower()),
            )
        )
    return statement


def is_approvable(punch: Punch) -> bool:
    """A rejected punch that names someone, except a repeat scan (spec §7 rule 7)."""
    names_someone = punch.employee_id is not None or punch.claimed_employee_id is not None
    first_code = punch.reason_codes[0] if punch.reason_codes else None
    return (
        punch.decision == PunchDecision.REJECTED.value and names_someone and first_code != COOLDOWN
    )


def _people(session: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, Employee]:
    if not ids:
        return {}
    return {e.id: e for e in session.scalars(select(Employee).where(Employee.id.in_(ids)))}


def _person(employee: Employee | None) -> PunchLogEmployee | None:
    if employee is None:
        return None
    return PunchLogEmployee(id=employee.id, code=employee.employee_code, name=employee.full_name)


def review_items(session: Session, punches: list[Punch]) -> list[ReviewListItem]:
    viewer = super_admin_viewer()
    items = presenter.punch_items(session, punches, viewer)
    reviews = latest_reviews(session, [p.id for p in punches])
    claimed = _people(session, {p.claimed_employee_id for p in punches if p.claimed_employee_id})
    history = presenter.review_outputs(session, list(reviews.values()))
    result = []
    for punch, item in zip(punches, items, strict=True):
        review = reviews.get(punch.id)
        result.append(
            ReviewListItem(
                punch=ReviewPunch(
                    **item.model_dump(),
                    time_proof=punch.time_proof,  # type: ignore[arg-type]
                    claimed_employee=_person(claimed.get(punch.claimed_employee_id))  # type: ignore[arg-type]
                    if punch.claimed_employee_id
                    else None,
                ),
                latest_review=history.get(review.id) if review else None,
                approvable=is_approvable(punch),
            )
        )
    return result


def super_admin_viewer() -> presenter.Viewer:
    return presenter.Viewer(
        only_plant_ids=None,
        sees_dark_photos=True,
        sees_face_scores=True,
        sees_review_reasons=True,
    )


# --- Summary and digest ------------------------------------------------------------------------


def _to_check_condition():  # noqa: ANN202 (a SQL condition)
    return and_(Punch.decision == PunchDecision.FLAGGED.value, ~_has_review)


def review_summary(session: Session, plant_id: uuid.UUID | None, now: datetime) -> ReviewSummary:
    """Numbers for the sidebar badge and the dashboard card."""
    plant_condition = [Punch.plant_id == plant_id] if plant_id is not None else []
    to_check = session.scalar(
        select(func.count()).select_from(Punch).where(_to_check_condition(), *plant_condition)
    )
    rejected = session.scalar(
        _hide_repeat_scans(
            select(func.count())
            .select_from(Punch)
            .where(
                Punch.decision == PunchDecision.REJECTED.value,
                ~_has_review,
                Punch.punch_time >= now - timedelta(days=7),
                *plant_condition,
            )
        )
    )
    codes = (
        select(func.unnest(Punch.reason_codes).label("code"))
        .where(_to_check_condition(), *plant_condition)
        .subquery()
    )
    by_code = dict(session.execute(select(codes.c.code, func.count()).group_by(codes.c.code)).all())
    return ReviewSummary(
        to_check=to_check or 0, rejected_last_7_days=rejected or 0, by_code=by_code
    )


def check_digest_day(day: date) -> None:
    today = today_ist()
    if not today - timedelta(days=DIGEST_DAYS_BACK) <= day <= today:
        raise ApiError(
            "VALIDATION_FAILED",
            f"The digest covers the last {DIGEST_DAYS_BACK} days only.",
            422,
            {"fields": {"date": "range"}},
        )


def review_digest(session: Session, day: date, now: datetime) -> ReviewDigest:
    """One IST day per plant (F-48): flagged, rejected naming someone, still to check, and the
    minutes its attendance devices were offline during shifts."""
    start, end = _ist_bounds(day, day)
    in_day = and_(Punch.punch_time >= start, Punch.punch_time < end)
    counts: dict[uuid.UUID, dict[str, int]] = {}

    def count_by_plant(name: str, *conditions) -> None:  # noqa: ANN002
        rows = session.execute(
            select(Punch.plant_id, func.count()).where(in_day, *conditions).group_by(Punch.plant_id)
        )
        for plant_id, number in rows:
            counts.setdefault(plant_id, {})[name] = number

    count_by_plant("flagged", Punch.decision == PunchDecision.FLAGGED.value)
    count_by_plant(
        "rejected_with_employee",
        Punch.decision == PunchDecision.REJECTED.value,
        _named_person.is_not(None),
        func.coalesce(_first_code, "") != COOLDOWN,
    )
    count_by_plant("to_check", _to_check_condition())

    plants = list(
        session.scalars(select(Plant).where(Plant.is_active.is_(True)).order_by(Plant.code))
    )
    kiosks = list(
        session.scalars(select(KioskDevice).where(KioskDevice.status == KioskStatus.ACTIVE.value))
    )
    rows = []
    for plant in plants:
        offline = sum(
            offline_minutes_in_shifts(session, kiosk, day, now)
            for kiosk in kiosks
            if kiosk.plant_id == plant.id
        )
        numbers = counts.get(plant.id, {})
        rows.append(
            DigestPlant(
                plant=DigestPlace(id=plant.id, code=plant.code, name=plant.name),
                flagged=numbers.get("flagged", 0),
                rejected_with_employee=numbers.get("rejected_with_employee", 0),
                to_check=numbers.get("to_check", 0),
                device_offline_minutes_in_shifts=offline,
            )
        )
    return ReviewDigest(date=day, plants=rows)


# --- One punch: the review panel ----------------------------------------------------------------


@dataclass(frozen=True)
class _Limits:
    cooldown_minutes: int
    min_minutes_before_out: int
    open_in_max_hours: int
    travel_kmh: int
    travel_min_distance_m: int
    two_devices_minutes: int
    hint_employee_rejections: int
    hint_device_edge_flags: int


def _limits(session: Session) -> _Limits:
    return _Limits(
        cooldown_minutes=get_int_setting(session, "punch_cooldown_minutes"),
        min_minutes_before_out=get_int_setting(session, "min_minutes_before_out"),
        open_in_max_hours=get_int_setting(session, "open_in_max_hours"),
        travel_kmh=get_int_setting(session, "impossible_travel_kmh"),
        travel_min_distance_m=get_int_setting(session, "impossible_travel_min_distance_m"),
        two_devices_minutes=get_int_setting(session, "same_person_two_devices_minutes"),
        hint_employee_rejections=get_int_setting(session, "review_hint_employee_rejections"),
        hint_device_edge_flags=get_int_setting(session, "review_hint_device_edge_flags"),
    )


def get_punch_or_404(session: Session, punch_id: uuid.UUID) -> Punch:
    punch = session.get(Punch, punch_id)
    if punch is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return punch


def review_context(session: Session, punch: Punch) -> ReviewContext:
    limits = _limits(session)
    viewer = super_admin_viewer()
    person_id = punch.employee_id or punch.claimed_employee_id
    claimed = (
        session.get(Employee, punch.claimed_employee_id) if punch.claimed_employee_id else None
    )
    fence = _fence_of(session, punch)
    approvable = is_approvable(punch)
    return ReviewContext(
        punch=presenter.punch_detail(session, punch, viewer),
        claimed_employee=_person(claimed),
        geofence=fence,
        distance_m=float(punch.geofence_distance_m)
        if punch.geofence_distance_m is not None
        else None,
        margin_m=fence.buffer_m if fence is not None else None,
        related=_related(session, punch, limits, viewer),
        suggestion=Suggestion(direction=suggested_direction(session, punch, limits))  # type: ignore[arg-type]
        if approvable and person_id is not None
        else None,
        nearby_counted=_nearby_counted(session, punch, person_id, limits),
        reviews=presenter.review_history(session, punch.id, full=True),
        hints=_hints(session, punch, person_id, limits),
        approvable=approvable,
        limits={
            "impossible_travel_kmh": limits.travel_kmh,
            "punch_cooldown_minutes": limits.cooldown_minutes,
        },
    )


def _fence_of(session: Session, punch: Punch) -> ContextFence | None:
    """The fence version the punch was judged against (stored on the row since M4), else the
    version that was current at the punch time."""
    fence = session.get(Geofence, punch.geofence_id) if punch.geofence_id else None
    if fence is None:
        fence = geofence_at(session, punch.plant_id, punch.punch_time)
    if fence is None:
        return None
    return ContextFence(
        version_id=fence.id,
        version=fence.version,
        shape=fence.shape,
        geojson=fence.geojson,
        radius_m=float(fence.radius_m) if fence.radius_m is not None else None,
        buffer_m=fence.buffer_m,
    )


def suggested_direction(session: Session, punch: Punch, limits: _Limits) -> str:
    """The direction the IN/OUT rule (§7 rule 5) would give at the punch time, from what counts
    now. The cool-down and "OUT too soon" refusals do not apply: the Super Admin decides."""
    person_id = punch.employee_id or punch.claimed_employee_id
    last = last_counted_before(session, person_id, punch.punch_time) if person_id else None
    if last is None or last.direction != Direction.IN.value:
        return Direction.IN.value
    if punch.punch_time - last.punch_time < timedelta(hours=limits.open_in_max_hours):
        return Direction.OUT.value
    return Direction.IN.value  # the old IN was left open; this starts a new day


def _nearby_counted(
    session: Session, punch: Punch, person_id: uuid.UUID | None, limits: _Limits
) -> list[NearbyCounted]:
    """Counted punches of the same person within the cool-down (the approve warning)."""
    if person_id is None:
        return []
    window = timedelta(minutes=limits.cooldown_minutes)
    return [
        NearbyCounted(
            punch_id=counted.punch.id,
            punch_time=counted.punch_time,
            direction=counted.direction,  # type: ignore[arg-type]
        )
        for counted in counted_between(
            session, person_id, punch.punch_time - window, punch.punch_time + window
        )
        if counted.punch.id != punch.id
    ]


def _position(session: Session, punch: Punch) -> tuple[float, float] | None:
    if punch.lat is not None and punch.lon is not None:
        return float(punch.lat), float(punch.lon)
    fence = current_geofence(session, punch.plant_id)  # M2/M3 rows have no stored position
    return geofence_centre(fence.shape, fence.geojson) if fence is not None else None


def _related(
    session: Session, punch: Punch, limits: _Limits, viewer: presenter.Viewer
) -> list[RelatedPunch]:
    """The other punches behind a travel, two-devices or order flag: the linked one, plus (for
    two devices) every punch of the person at another device within the window."""
    codes = set(punch.reason_codes)
    if not codes & RELATED_FLAGS:
        return []
    others: dict[uuid.UUID, Punch] = {}
    if punch.related_punch_id is not None:
        linked = session.get(Punch, punch.related_punch_id)
        if linked is not None:
            others[linked.id] = linked
    if "TWO_DEVICES_SOON" in codes and punch.employee_id is not None:
        window = timedelta(minutes=limits.two_devices_minutes)
        for counted in counted_between(
            session, punch.employee_id, punch.punch_time - window, punch.punch_time + window
        ):
            if counted.punch.kiosk_id != punch.kiosk_id and counted.punch.id != punch.id:
                others.setdefault(counted.punch.id, counted.punch)
    here = _position(session, punch)
    related = []
    for other in others.values():
        there = _position(session, other)
        distance = distance_between_m(*here, *there) if here and there else None
        minutes = abs((punch.punch_time - other.punch_time).total_seconds()) / 60
        # Same as the travel rule: at least one minute apart, so a speed is never infinite.
        speed = distance / 1000 / (max(minutes, 1) / 60) if distance is not None else None
        related.append(
            RelatedPunch(
                punch=presenter.punch_detail(session, other, viewer),
                relation=_relation(punch, other, codes, distance, minutes, speed, limits),  # type: ignore[arg-type]
                distance_m=round(distance, 1) if distance is not None else None,
                minutes_apart=round(minutes, 1),
                speed_kmh=round(speed, 1) if speed is not None else None,
            )
        )
    return sorted(related, key=lambda item: item.minutes_apart)


def _relation(
    punch: Punch,
    other: Punch,
    codes: set[str],
    distance: float | None,
    minutes: float,
    speed: float | None,
    limits: _Limits,
) -> str:
    elsewhere = other.kiosk_id != punch.kiosk_id
    too_fast = (
        distance is not None
        and speed is not None
        and distance >= limits.travel_min_distance_m
        and speed > limits.travel_kmh
    )
    if elsewhere and "IMPOSSIBLE_TRAVEL" in codes and too_fast:
        return "travel"
    if elsewhere and "TWO_DEVICES_SOON" in codes and minutes <= limits.two_devices_minutes:
        return "two_devices"
    if "SYNC_ORDER_CONFLICT" in codes and other.id == punch.related_punch_id:
        return "order"
    return "travel" if "IMPOSSIBLE_TRAVEL" in codes else "two_devices"


def _hints(
    session: Session, punch: Punch, person_id: uuid.UUID | None, limits: _Limits
) -> list[ReviewHint]:
    """Repeat patterns over the 7 days before the punch (F-54). Hints only: nothing is blocked."""
    since = punch.punch_time - timedelta(days=HINT_DAYS)
    in_window = and_(Punch.punch_time >= since, Punch.punch_time <= punch.punch_time)
    dates = _dates_before(punch.punch_time)
    hints = []

    def count(*conditions) -> int:  # noqa: ANN002
        return (
            session.scalar(select(func.count()).select_from(Punch).where(in_window, *conditions))
            or 0
        )

    if person_id is not None:
        rejections = count(
            Punch.decision == PunchDecision.REJECTED.value,
            _named_person == person_id,
            func.coalesce(_first_code, "") != COOLDOWN,
        )
        if rejections >= limits.hint_employee_rejections:
            hints.append(
                ReviewHint(
                    kind="employee_rejections",
                    count=rejections,
                    filter={"tab": "rejected", "employee_id": str(person_id), **dates},
                )
            )
    edge_flags = count(
        Punch.kiosk_id == punch.kiosk_id, Punch.reason_codes.contains(["LOCATION_AT_EDGE"])
    )
    if edge_flags >= limits.hint_device_edge_flags:
        hints.append(
            ReviewHint(
                kind="device_edge_flags",
                count=edge_flags,
                filter={
                    "tab": "to_check",
                    "kiosk_id": str(punch.kiosk_id),
                    "code": "LOCATION_AT_EDGE",
                    **dates,
                },
            )
        )
    if punch.qr_credential_id is not None:
        card_flags = count(
            Punch.qr_credential_id == punch.qr_credential_id,
            Punch.reason_codes.contains(["TWO_DEVICES_SOON"]),
        )
        if card_flags >= CARD_TWO_DEVICES_HINT:
            hints.append(
                ReviewHint(
                    kind="card_two_devices",
                    count=card_flags,
                    filter={
                        "tab": "to_check",
                        "code": "TWO_DEVICES_SOON",
                        **({"employee_id": str(person_id)} if person_id else {}),
                        **dates,
                    },
                )
            )
    return hints


def _dates_before(moment: datetime) -> dict[str, str]:
    """The IST days of the 7 days before `moment`, for the linked list."""
    last_day = to_ist(moment).date()
    return {
        "date_from": (last_day - timedelta(days=HINT_DAYS)).isoformat(),
        "date_to": last_day.isoformat(),
    }


# --- Adding a review ----------------------------------------------------------------------------


def add_review(
    session: Session, punch_id: uuid.UUID, request: ReviewRequest, user_id: uuid.UUID, actor: Actor
) -> PunchReviewOut:
    # Locks the punch row (never updated: the append-only trigger only refuses changes), so two
    # Super Admins reviewing the same punch at once are handled one after the other.
    punch = session.scalar(select(Punch).where(Punch.id == punch_id).with_for_update())
    if punch is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    latest = latest_review(session, punch.id)
    _check_not_changed(session, latest, request.expected_latest_review_id)
    _check_allowed(punch, request.action, latest)

    review = PunchReview(
        punch_id=punch.id,
        action=ACTIONS[request.action],
        direction=request.direction,
        employee_id=punch.employee_id or punch.claimed_employee_id,
        reason=request.reason,
        reviewed_by=user_id,
        reviewed_at=utc_now(),
        supersedes_review_id=latest.id if latest else None,
    )
    session.add(review)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action=f"punch_review.{request.action}",
        entity_type="punch",
        entity_id=punch.id,
        after={
            "punch_id": str(punch.id),
            "review_id": str(review.id),
            "employee_id": str(review.employee_id) if review.employee_id else None,
            "direction": review.direction,
            "reason": review.reason,
            "supersedes_review_id": str(latest.id) if latest else None,
        },
        reason=review.reason,
        plant_id=punch.plant_id,
    )
    # The review can change which day (and whose day) the punch counts for (M5 §7 rule 14).
    mark_punch_stale(
        session, punch, also_for=[review.employee_id, latest.employee_id if latest else None]
    )
    session.commit()
    return presenter.review_outputs(session, [review])[review.id]


def _check_not_changed(
    session: Session, latest: PunchReview | None, expected_id: uuid.UUID | None
) -> None:
    if (latest.id if latest else None) == expected_id:
        return
    details: dict[str, object] = {}
    if latest is not None:
        shown = presenter.review_outputs(session, [latest])[latest.id]
        details = {
            "reviewed_by": shown.reviewed_by.name if shown.reviewed_by else None,
            "reviewed_at": latest.reviewed_at.isoformat(),
            "action": latest.action,
        }
    raise ApiError(
        "REVIEW_CHANGED",
        "This punch was reviewed in the meantime. Load the latest and decide again.",
        409,
        details,
    )


def _check_allowed(punch: Punch, action: str, latest: PunchReview | None) -> None:
    """Which action fits which punch (spec §7 rule 7, decision 0027)."""
    if punch.decision == PunchDecision.FLAGGED.value:
        if action == "approve":
            raise _not_allowed(
                "A flagged punch already counts: confirm it or mark it not accepted."
            )
        return
    if punch.decision != PunchDecision.REJECTED.value:
        raise _not_allowed("Only flagged and rejected punches are reviewed.")
    if action == "confirm":
        raise _not_allowed("A rejected punch can only be approved.")
    if action == "not_accepted":
        # Allowed only to withdraw an approval given earlier.
        if latest is None or latest.action != ReviewAction.APPROVED.value:
            raise _not_allowed("A rejected punch can only be approved.")
        return
    if punch.employee_id is None and punch.claimed_employee_id is None:
        raise ApiError("REVIEW_NO_EMPLOYEE", "No employee is known for this punch.", 409)
    if punch.reason_codes and punch.reason_codes[0] == COOLDOWN:
        raise _not_allowed("This scan came right after a punch that already counts.")
