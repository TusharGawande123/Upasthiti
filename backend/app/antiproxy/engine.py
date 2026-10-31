"""Runs the anti-proxy rules in a fixed order (M2 spec §7, M4 spec §7 rule 2).

The first rule that rejects decides. A rule that FLAGS (M4) adds its code and the chain goes on:
a punch with flags and no rejection is "flagged" - it counts as IN/OUT at once, and the Super
Admin looks at it later. A rejected punch keeps the flags collected before the rejection, after
its rejection code (useful in the review; the gate shows only the first code).

Card punch order: the card is only READ first (so a refused test card is always recognised), then
the device's location (cheap, and it stops a device taken home before any other work), the photo,
the card, IN/OUT, and last the flag rules, which need the person and the decided time. The face
punch runs the location rules before its face worker and the same last rules after it.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from app.antiproxy.context import Outcome, PunchContext, RuleResult
from app.antiproxy.face_context import FacePunchContext
from app.antiproxy.rules.cooldown import check_in_out
from app.antiproxy.rules.face_antispoof import check_antispoof
from app.antiproxy.rules.face_challenge import check_challenge
from app.antiproxy.rules.face_consistency import check_consistency
from app.antiproxy.rules.face_frames import check_frames
from app.antiproxy.rules.face_liveness import check_liveness
from app.antiproxy.rules.face_match import check_match
from app.antiproxy.rules.impossible_travel import check_impossible_travel
from app.antiproxy.rules.kiosk_location import check_kiosk_location, check_location_age
from app.antiproxy.rules.offline_time import check_offline_age, check_time_proven
from app.antiproxy.rules.qr_credential import check_qr_credential
from app.antiproxy.rules.read_card import read_card
from app.antiproxy.rules.shift_closed import check_shift_closed
from app.antiproxy.rules.snapshot import check_snapshot
from app.antiproxy.rules.two_devices import check_two_devices
from app.modules.punches.models import Direction, PunchDecision

Rule = Callable[[PunchContext], RuleResult]

LOCATION_RULES: tuple[Rule, ...] = (check_kiosk_location, check_location_age)
# After the person is known: IN/OUT first, then the flag rules that need the decided time.
# M5: right after IN/OUT, one IN and one OUT per shift (`check_shift_closed`).
AFTER_IDENTITY_RULES: tuple[Rule, ...] = (
    check_in_out,
    check_shift_closed,
    check_impossible_travel,
    check_two_devices,
)

# M4 offline punches: the time flags come last (§7 rule 2); live punches pass them anyway.
OFFLINE_TIME_RULES: tuple[Rule, ...] = (check_time_proven, check_offline_age)

QR_RULES: tuple[Rule, ...] = (
    read_card,
    *LOCATION_RULES,
    check_snapshot,
    check_qr_credential,
    *AFTER_IDENTITY_RULES,
)
OFFLINE_QR_RULES: tuple[Rule, ...] = (*QR_RULES, *OFFLINE_TIME_RULES)

# A test card proves the gate works; it never makes a punch, so the location rules do not refuse
# it. The self-test answer reports the location verdict instead (M4 spec §5.1).
TEST_CARD_RULES: tuple[Rule, ...] = (read_card, check_snapshot, check_qr_credential)

FaceRule = Callable[[FacePunchContext], RuleResult]
# M3 (spec §7 rule 5): cheap checks first (a used challenge costs one query), the detector
# before liveness, the small anti-spoof model before the embeddings, matching last. The location
# rules run before these and AFTER_IDENTITY_RULES after them, outside the face worker, with the
# employee's row locked.
FACE_RULES: tuple[FaceRule, ...] = (
    check_challenge,
    check_frames,
    check_liveness,
    check_antispoof,
    check_consistency,
    check_match,
)


# M4 offline face punch: the device chose the turn (checked by offline_face.py first), and the
# 1:1 match against the typed code replaces the 1:N match.
OFFLINE_FACE_RULES: tuple[FaceRule, ...] = (
    check_frames,
    check_liveness,
    check_antispoof,
    check_consistency,
)


@dataclass(frozen=True)
class EngineDecision:
    outcome: Outcome  # ALLOW (accepted or flagged), REJECT or SELF_TEST
    reason_codes: list[str]  # rejection code first, then flags; only flags when allowed
    direction: Direction | None  # set only when the punch counts
    flag_codes: list[str] = field(default_factory=list)

    @property
    def decision_value(self) -> str:
        """The `punches.decision` value for this outcome."""
        if self.outcome is Outcome.REJECT:
            return PunchDecision.REJECTED.value
        return PunchDecision.FLAGGED.value if self.flag_codes else PunchDecision.ACCEPTED.value


def run_rules(context: PunchContext, rules: tuple[Rule, ...]) -> EngineDecision:
    flags: list[str] = []
    for rule in rules:
        result = rule(context)
        if result.outcome is Outcome.REJECT:
            # RuleResult guarantees a code, so no rule can reject "silently" into a pass.
            codes = [result.reason_code or "INTERNAL_ERROR", *flags]
            return EngineDecision(Outcome.REJECT, codes, None, flags)
        if result.outcome is Outcome.SELF_TEST:
            return EngineDecision(Outcome.SELF_TEST, [], None)
        if result.outcome is Outcome.FLAG and result.reason_code not in flags:
            flags.append(result.reason_code or "INTERNAL_ERROR")
    return EngineDecision(Outcome.ALLOW, list(flags), context.direction, flags)


def combine(earlier: EngineDecision, later: EngineDecision) -> EngineDecision:
    """Joins two parts of one punch's chain (the face punch runs its rules in parts). `earlier`
    allowed the punch; its flags stay first."""
    flags = [*earlier.flag_codes, *(f for f in later.flag_codes if f not in earlier.flag_codes)]
    if later.outcome is Outcome.REJECT:
        return EngineDecision(Outcome.REJECT, [later.reason_codes[0], *flags], None, flags)
    return EngineDecision(Outcome.ALLOW, list(flags), later.direction, flags)


def rejected_after(earlier: EngineDecision, reason_code: str) -> EngineDecision:
    """A refusal outside the rule lists (a face rule) after `earlier` allowed the punch."""
    flags = list(earlier.flag_codes)
    return EngineDecision(Outcome.REJECT, [reason_code, *flags], None, flags)


def run_qr_rules(context: PunchContext, rules: tuple[Rule, ...] = QR_RULES) -> EngineDecision:
    return run_rules(context, rules)


def run_face_rules(
    context: FacePunchContext, rules: tuple[FaceRule, ...] = FACE_RULES
) -> RuleResult:
    """The first refusal wins; ALLOW means the face is known (context.employee is set)."""
    for rule in rules:
        result = rule(context)
        if result.outcome is Outcome.REJECT:
            return result
    return RuleResult.passed()
