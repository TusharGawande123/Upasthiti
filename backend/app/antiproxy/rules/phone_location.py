"""Rules: where may an employee punch from their own phone? (M4b spec §7 rule 12)

The phone sends a fresh GPS reading; the server judges it against fences, in this order:
  1. the employee's OWN plant fence: inside = fine, inside the margin = flag LOCATION_AT_EDGE;
  2. beyond the margin and no outside work allowed = REJECT OUTSIDE_GEOFENCE;
  3. outside work allowed: inside ANOTHER Sheet Shapers plant's fence = fine, no flag (that plant
     becomes `location_plant_id`, so "Inside now" and the muster show the person there);
  4. inside no plant at all = FLAG OUTSIDE_PLANT (it counts at once, the Super Admin looks at it).
`check_phone_location_at_gate` is the variant of a gate-code punch and of a card proof: only the
own plant's fence counts, so outside work never helps there.
A faked phone location passes these rules: the live face (or the changing gate code and the photo),
the flag rules and the review back them up (spec §8.3).
"""

from sqlalchemy import select

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.kiosks.location_check import check_location
from app.modules.org.geofence import distance_to_geofence_m
from app.modules.org.models import Geofence, Plant


def check_phone_location(context: PunchContext) -> RuleResult:
    """Face punch: own plant, then (with outside work) every other plant, then OUTSIDE_PLANT."""
    return _judge(context, may_be_outside=context.outside_work_allowed)


def check_phone_location_at_gate(context: PunchContext) -> RuleResult:
    """Gate-code punch: the own plant's fence only (outside work does not apply)."""
    return _judge(context, may_be_outside=False)


def _judge(context: PunchContext, *, may_be_outside: bool) -> RuleResult:
    verdict = check_location(context.session, context.plant_id, context.location)
    if verdict.geofence is not None:
        # Stored on the row also when the punch is refused: the review shows "3.2 km from K134".
        context.geofence_id = verdict.geofence.id
        context.geofence_distance_m = verdict.distance_m
    if verdict.refusal_code is None:
        context.location_plant_id = context.plant_id
        return _edge_or_pass(verdict.at_edge)
    if verdict.refusal_code != "OUTSIDE_GEOFENCE" or not may_be_outside:
        return RuleResult.rejected(verdict.refusal_code)

    other = _other_plant_fence_at(context)
    if other is None:
        # Inside no plant: accepted and flagged; it is "inside" no plant (spec rule 22).
        return RuleResult.flagged("OUTSIDE_PLANT")
    fence, distance = other
    context.location_plant_id = fence.plant_id
    context.geofence_id = fence.id
    context.geofence_distance_m = distance
    return _edge_or_pass(distance > 0)


def _edge_or_pass(at_edge: bool) -> RuleResult:
    return RuleResult.flagged("LOCATION_AT_EDGE") if at_edge else RuleResult.passed()


def _other_plant_fence_at(context: PunchContext) -> tuple[Geofence, float] | None:
    """The nearest OTHER active plant whose fence (with its own margin) holds the position."""
    location = context.location
    if location is None:  # cannot happen here: a missing position was refused above
        return None
    fences = context.session.scalars(
        select(Geofence)
        .join(Plant, Plant.id == Geofence.plant_id)
        .where(Geofence.is_current.is_(True), Plant.is_active.is_(True))
        .where(Geofence.plant_id != context.plant_id)
    )
    best: tuple[Geofence, float] | None = None
    for fence in fences:
        distance = distance_to_geofence_m(
            fence.shape, fence.geojson, fence.radius_m, location.lon, location.lat
        )
        if distance <= fence.buffer_m and (best is None or distance < best[1]):
            best = (fence, distance)
    return best
