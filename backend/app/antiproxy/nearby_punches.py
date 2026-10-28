"""Where else was this person (or this card) around the time of a punch? Shared by the two flag
rules impossible_travel and two_devices (M4 spec §7 rule 14, decision 0012).

"Elsewhere" means at another gate device. Two kinds of punches tell where someone really was:
the punches that count (accepted, flagged, approved) and WRONG_PLANT rejections, which show
where a card was shown even though it was refused there.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_, select

from app.antiproxy.context import PunchContext
from app.modules.org.geofence import distance_between_m, geofence_centre
from app.modules.org.geofence_service import current_geofence
from app.modules.punches.counting import counted_between, first_counted_after, last_counted_before
from app.modules.punches.models import Punch, PunchDecision


@dataclass(frozen=True)
class OtherPunch:
    punch: Punch
    minutes_apart: float
    distance_m: float


def punches_elsewhere(context: PunchContext, window: timedelta) -> list[OtherPunch]:
    """This person's punches at other gate devices within `window` of this punch, nearest first."""
    employee = context.employee
    if employee is None:
        return []
    start, end = context.now - window, context.now + window
    found: dict[uuid.UUID, Punch] = {
        counted.punch.id: counted.punch
        for counted in counted_between(context.session, employee.id, start, end)
    }
    for punch in _wrong_plant_refusals(context, start, end):
        found.setdefault(punch.id, punch)
    return _describe(context, [p for p in found.values() if p.kiosk_id != context.kiosk.id])


def neighbours_elsewhere(context: PunchContext) -> list[OtherPunch]:
    """The person's last counted punch before and first after this one, plus WRONG_PLANT
    refusals within an hour, when they were at another gate device. Nearest first."""
    employee = context.employee
    if employee is None:
        return []
    found: dict[uuid.UUID, Punch] = {}
    before = last_counted_before(context.session, employee.id, context.now)
    after = first_counted_after(context.session, employee.id, context.now)
    for counted in (before, after):
        if counted is not None:
            found[counted.punch.id] = counted.punch
    hour = timedelta(hours=1)
    for punch in _wrong_plant_refusals(context, context.now - hour, context.now + hour):
        found.setdefault(punch.id, punch)
    return _describe(context, [p for p in found.values() if p.kiosk_id != context.kiosk.id])


def _wrong_plant_refusals(context: PunchContext, start: datetime, end: datetime) -> list[Punch]:
    employee = context.employee
    card = context.card
    same_person = [Punch.employee_id == employee.id] if employee is not None else []
    if card is not None:
        same_person.append(Punch.qr_credential_id == card.id)
    if not same_person:
        return []
    return list(
        context.session.scalars(
            select(Punch).where(
                Punch.decision == PunchDecision.REJECTED.value,
                Punch.reason_codes.contains(["WRONG_PLANT"]),
                Punch.punch_time >= start,
                Punch.punch_time <= end,
                or_(*same_person),
            )
        )
    )


def _describe(context: PunchContext, punches: list[Punch]) -> list[OtherPunch]:
    here = _position_of_this_punch(context)
    described = []
    for punch in punches:
        there = _position_of_stored_punch(context, punch)
        distance = (
            distance_between_m(here[0], here[1], there[0], there[1])
            if here is not None and there is not None
            else 0.0
        )
        minutes = abs((context.now - punch.punch_time).total_seconds()) / 60
        described.append(OtherPunch(punch, minutes, distance))
    return sorted(described, key=lambda other: other.minutes_apart)


def _position_of_this_punch(context: PunchContext) -> tuple[float, float] | None:
    if context.location is not None:
        return context.location.lat, context.location.lon
    return _plant_centre(context, context.kiosk.plant_id)


def _position_of_stored_punch(context: PunchContext, punch: Punch) -> tuple[float, float] | None:
    if punch.lat is not None and punch.lon is not None:
        return float(punch.lat), float(punch.lon)
    return _plant_centre(context, punch.plant_id)  # M2/M3 rows have no stored position


def _plant_centre(context: PunchContext, plant_id: uuid.UUID) -> tuple[float, float] | None:
    fence = current_geofence(context.session, plant_id)
    return geofence_centre(fence.shape, fence.geojson) if fence is not None else None
