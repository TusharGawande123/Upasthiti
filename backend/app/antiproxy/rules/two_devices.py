"""Rule: flag the same person or card at two gate devices within a few minutes (decision 0012).

A card can be copied by photographing it; two people using copies at two gates show up here.
Two devices side by side at one gate rarely trigger it: a second scan within the cool-down is
already refused (COOLDOWN_ACTIVE) and does not count. Flag only, never a rejection.
"""

from datetime import timedelta

from app.antiproxy.context import PunchContext, RuleResult
from app.antiproxy.nearby_punches import punches_elsewhere


def check_two_devices(context: PunchContext) -> RuleResult:
    window = timedelta(minutes=context.limits.same_person_two_devices_minutes)
    others = punches_elsewhere(context, window)  # nearest in time first
    if not others:
        return RuleResult.passed()
    # The travel rule may already have linked a punch; keep that link (it explains more).
    if context.related_punch_id is None:
        context.related_punch_id = others[0].punch.id
    return RuleResult.flagged("TWO_DEVICES_SOON")
