"""Rule: block scans that come too fast, and decide IN or OUT (M2 spec §7 rule 6, M4 §7 rule 5).

Only server-decided times are used: the punch time is the server clock for a live punch and the
proven time for an offline one. The last COUNTED punch (punches/counting.py) counts at ANY plant,
which is what lets "IN at one gate, OUT at another" work and stops a double IN at two gates.

  last counted punch ...              result
  less than `cooldown` ago            COOLDOWN_ACTIVE (a double scan; the screen shows "already")
  IN, less than `min before out` ago  OUT_TOO_SOON
  IN, less than `open IN max` ago     OUT
  IN, older than that                 IN (the OUT was forgotten; the old IN stays open)
  OUT, or no punch at all             IN
Every limit is "less than": a punch exactly at the limit already counts as past it.

Offline only: a punch synced late may be older than punches already decided. If the next counted
punch is within the cool-down it is a double punch (COOLDOWN_ACTIVE); if it is further away, the
direction still comes from the punch before, and SYNC_ORDER_CONFLICT is flagged, because the
next punch was decided without knowing this one (punch rows are never changed).
"""

from datetime import timedelta

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.punches.counting import first_counted_after, last_counted_before
from app.modules.punches.models import Direction


def check_in_out(context: PunchContext) -> RuleResult:
    employee = context.employee
    if employee is None:
        raise RuntimeError("the card or face rule must run before the IN/OUT rule")
    limits = context.limits
    cooldown = timedelta(minutes=limits.punch_cooldown_minutes)

    next_punch = None
    if context.is_offline:
        next_punch = first_counted_after(context.session, employee.id, context.now)
        if next_punch is not None and next_punch.punch_time - context.now < cooldown:
            return RuleResult.rejected("COOLDOWN_ACTIVE")

    last = last_counted_before(context.session, employee.id, context.now)
    if last is None:
        context.direction = Direction.IN
    else:
        age = context.now - last.punch_time
        if age < cooldown:
            return RuleResult.rejected("COOLDOWN_ACTIVE")
        if last.direction != Direction.IN.value:
            context.direction = Direction.IN
        elif age < timedelta(minutes=limits.min_minutes_before_out):
            return RuleResult.rejected("OUT_TOO_SOON")
        elif age < timedelta(hours=limits.open_in_max_hours):
            context.direction = Direction.OUT
        else:
            context.direction = Direction.IN

    if next_punch is not None:
        context.related_punch_id = next_punch.punch.id
        return RuleResult.flagged("SYNC_ORDER_CONFLICT")
    return RuleResult.passed()
