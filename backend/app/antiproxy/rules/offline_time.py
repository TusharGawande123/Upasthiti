"""Rules: flags about the time of an offline punch (M4 spec §7 rule 8, decision 0025 item 6).

Both only flag, never reject: a power cut or a long outage must not lose an honest punch.
  the time could not be proven (device restarted, clocks disagree)   FLAG OFFLINE_TIME_UNPROVEN
  sent more than `offline_max_hours` after the punch                  FLAG OFFLINE_TOO_OLD
Live punches pass both.
"""

from datetime import timedelta

from app.antiproxy.context import PunchContext, RuleResult


def check_time_proven(context: PunchContext) -> RuleResult:
    if context.is_offline and context.time_proof != "anchored":
        return RuleResult.flagged("OFFLINE_TIME_UNPROVEN")
    return RuleResult.passed()


def check_offline_age(context: PunchContext) -> RuleResult:
    if not context.is_offline or context.received_at is None:
        return RuleResult.passed()
    if context.received_at - context.now > timedelta(hours=context.limits.offline_max_hours):
        return RuleResult.flagged("OFFLINE_TOO_OLD")
    return RuleResult.passed()
