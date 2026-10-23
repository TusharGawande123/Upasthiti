"""Runs the anti-proxy rules in a fixed order; the first rule that does not pass decides.

The order matters: the card is only READ first (so a refused test card is always recognised),
then the photo is checked (a punch without a usable photo is refused before the card is judged),
then the card, then the IN/OUT decision. M3 and M4 add their rules
to this list (kiosk location, impossible travel); the face punch has its own list (FACE_RULES).
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.antiproxy.context import Outcome, PunchContext, RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.antiproxy.rules.cooldown import check_in_out
from app.antiproxy.rules.face_antispoof import check_antispoof
from app.antiproxy.rules.face_challenge import check_challenge
from app.antiproxy.rules.face_consistency import check_consistency
from app.antiproxy.rules.face_frames import check_frames
from app.antiproxy.rules.face_liveness import check_liveness
from app.antiproxy.rules.face_match import check_match
from app.antiproxy.rules.qr_credential import check_qr_credential
from app.antiproxy.rules.read_card import read_card
from app.antiproxy.rules.snapshot import check_snapshot
from app.modules.punches.models import Direction

Rule = Callable[[PunchContext], RuleResult]

QR_RULES: tuple[Rule, ...] = (read_card, check_snapshot, check_qr_credential, check_in_out)

FaceRule = Callable[[FacePunchContext], RuleResult]
# M3 (spec §7 rule 5): cheap checks first (a used challenge costs one query), the detector
# before liveness, the small anti-spoof model before the embeddings, matching last. The IN/OUT
# rule (check_in_out) runs after these, outside the face worker, with the employee's row locked.
FACE_RULES: tuple[FaceRule, ...] = (
    check_challenge,
    check_frames,
    check_liveness,
    check_antispoof,
    check_consistency,
    check_match,
)


@dataclass(frozen=True)
class EngineDecision:
    outcome: Outcome
    reason_codes: list[str]  # one code when rejected, otherwise empty
    direction: Direction | None  # set only when accepted


def run_qr_rules(context: PunchContext, rules: tuple[Rule, ...] = QR_RULES) -> EngineDecision:
    for rule in rules:
        result = rule(context)
        if result.outcome is Outcome.REJECT:
            # RuleResult guarantees a reason code, so no rule can reject "silently" into a pass.
            return EngineDecision(Outcome.REJECT, [result.reason_code or "INTERNAL_ERROR"], None)
        if result.outcome is Outcome.SELF_TEST:
            return EngineDecision(Outcome.SELF_TEST, [], None)
    return EngineDecision(Outcome.ALLOW, [], context.direction)


def run_face_rules(
    context: FacePunchContext, rules: tuple[FaceRule, ...] = FACE_RULES
) -> RuleResult:
    """The first refusal wins; ALLOW means the face is known (context.employee is set)."""
    for rule in rules:
        result = rule(context)
        if result.outcome is Outcome.REJECT:
            return result
    return RuleResult.passed()
