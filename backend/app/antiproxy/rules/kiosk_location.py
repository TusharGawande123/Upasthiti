"""Rules: the gate device must be at its plant when the punch is made (M4 spec §7 rule 4).

They run first, before any card or face work: a phone or PC taken home is refused at once.
  no position / too inaccurate / no fence / beyond the margin   REJECT (the M1 pairing codes)
  outside the drawn shape but within the margin                 FLAG LOCATION_AT_EDGE
  an offline punch that reused an older reading                 FLAG LOCATION_STALE
The fence is the version that was current at the punch time. A faked browser location passes
these rules; the device key, the photo, the live face and the flag rules back them up (§8.3).
"""

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.kiosks.location_check import check_location


def check_kiosk_location(context: PunchContext) -> RuleResult:
    # Online the fence of "now"; offline the fence of the proven punch time. An unproven time was
    # partly chosen by the device, so it is judged against today's fence (as facts_at_time does):
    # otherwise a device could pick a moment when an older, wider fence version was current.
    moment = context.now if context.judges_at_punch_time else None
    verdict = check_location(
        context.session, context.kiosk.plant_id, context.location, moment=moment
    )
    if verdict.geofence is not None:
        context.geofence_id = verdict.geofence.id
        context.geofence_distance_m = verdict.distance_m
    if verdict.refusal_code is not None:
        return RuleResult.rejected(verdict.refusal_code)
    if verdict.at_edge:
        return RuleResult.flagged("LOCATION_AT_EDGE")
    return RuleResult.passed()


def check_location_age(context: PunchContext) -> RuleResult:
    """Offline only: the gate may reuse its last good reading of the same page session while it
    has no internet (§14 answer 1). Online the device itself refuses old readings."""
    age = context.location_age_s
    if context.is_offline and age is not None and age > context.limits.location_max_age_seconds:
        return RuleResult.flagged("LOCATION_STALE")
    return RuleResult.passed()
