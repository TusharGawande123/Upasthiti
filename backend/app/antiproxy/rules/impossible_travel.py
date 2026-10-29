"""Rule: flag a punch that needs a faster trip than anyone can make (M4 spec §7 rule 14).

Compares this punch with the person's neighbouring punches at other gate devices:
  distance below `impossible_travel_min_distance_m`   ignored (GPS noise, gates of one plant)
  speed = distance / time apart (at least 1 minute)
  speed above `impossible_travel_kmh`                 FLAG IMPOSSIBLE_TRAVEL (never a rejection:
                                                      the earlier punch may be the fake one)
"""

from app.antiproxy.context import PunchContext, RuleResult
from app.antiproxy.nearby_punches import neighbours_elsewhere

MIN_MINUTES_APART = 1.0  # two punches in the same minute count as one minute apart


def check_impossible_travel(context: PunchContext) -> RuleResult:
    limits = context.limits
    for other in neighbours_elsewhere(context):  # nearest in time first
        if other.distance_m < limits.impossible_travel_min_distance_m:
            continue
        hours = max(other.minutes_apart, MIN_MINUTES_APART) / 60
        speed_kmh = (other.distance_m / 1000) / hours
        if speed_kmh > limits.impossible_travel_kmh:
            context.related_punch_id = other.punch.id
            return RuleResult.flagged("IMPOSSIBLE_TRAVEL")
    return RuleResult.passed()
