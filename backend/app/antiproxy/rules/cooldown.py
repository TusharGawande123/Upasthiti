"""Rule: block scans that come too fast, and decide IN or OUT (spec M2 §7 rule 6).

Only the server clock is used. The last accepted punch counts at ANY plant, which is what lets
"IN at one gate, OUT at another" work and stops a double IN at two gates.

  last accepted punch ...             result
  less than `cooldown` ago            COOLDOWN_ACTIVE (a double scan; the screen shows "already")
  IN, less than `min before out` ago  OUT_TOO_SOON
  IN, less than `open IN max` ago     OUT
  IN, older than that                 IN (the OUT was forgotten; the old IN stays open)
  OUT, or no punch at all             IN
Every limit is "less than": a punch exactly at the limit already counts as past it.
"""

from datetime import timedelta

from sqlalchemy import select

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.punches.models import Direction, Punch, PunchDecision


def check_in_out(context: PunchContext) -> RuleResult:
    employee = context.employee
    if employee is None:
        raise RuntimeError("the card rule must run before the IN/OUT rule")
    limits = context.limits

    last = context.session.scalar(
        select(Punch)
        .where(Punch.employee_id == employee.id, Punch.decision == PunchDecision.ACCEPTED.value)
        .order_by(Punch.server_received_at.desc())
        .limit(1)
    )
    if last is None:
        context.direction = Direction.IN
        return RuleResult.passed()

    age = context.now - last.server_received_at
    if age < timedelta(minutes=limits.punch_cooldown_minutes):
        return RuleResult.rejected("COOLDOWN_ACTIVE")
    if last.direction != Direction.IN.value:
        context.direction = Direction.IN
        return RuleResult.passed()
    if age < timedelta(minutes=limits.min_minutes_before_out):
        return RuleResult.rejected("OUT_TOO_SOON")
    if age < timedelta(hours=limits.open_in_max_hours):
        context.direction = Direction.OUT
    else:
        context.direction = Direction.IN
    return RuleResult.passed()
