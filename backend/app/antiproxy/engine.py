"""Runs the anti-proxy rules in a fixed order; the first rule that does not pass decides.

The order matters: the photo is checked first (a punch without a usable photo is refused before
anything else is looked at), then the card, then the IN/OUT decision. M3 and M4 add their rules
to this list (face match, kiosk location, impossible travel); the endpoint does not change.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.antiproxy.context import Outcome, PunchContext, RuleResult
from app.antiproxy.rules.cooldown import check_in_out
from app.antiproxy.rules.qr_credential import check_qr_credential
from app.antiproxy.rules.snapshot import check_snapshot
from app.modules.punches.models import Direction

Rule = Callable[[PunchContext], RuleResult]

QR_RULES: tuple[Rule, ...] = (check_snapshot, check_qr_credential, check_in_out)


@dataclass(frozen=True)
class EngineDecision:
    outcome: Outcome
    reason_codes: list[str]  # one code when rejected, otherwise empty
    direction: Direction | None  # set only when accepted


def run_qr_rules(context: PunchContext, rules: tuple[Rule, ...] = QR_RULES) -> EngineDecision:
    for rule in rules:
        result = rule(context)
        if result.outcome is Outcome.REJECT and result.reason_code is not None:
            return EngineDecision(Outcome.REJECT, [result.reason_code], None)
        if result.outcome is Outcome.SELF_TEST:
            return EngineDecision(Outcome.SELF_TEST, [], None)
    return EngineDecision(Outcome.ALLOW, [], context.direction)
