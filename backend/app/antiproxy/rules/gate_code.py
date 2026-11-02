"""Rule: the scanned phone code must be a real, fresh code of this employee's plant gate (M4b spec
§7 rule 15). Checks in a fixed order, so the same bad text always gets the same code:
  shape or signature wrong          GATE_CODE_INVALID
  too old, or from the future       GATE_CODE_EXPIRED
  device unknown / revoked          GATE_CODE_INVALID
  the device is at another plant    WRONG_PLANT
The endpoint looks the named device up first (`context.gate_device`), because every stored row of a
gate-code punch names it. No ID card is checked: the sign-in is enough (lead, spec §14 answer 4).
"""

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.kiosks.models import KioskStatus
from app.modules.phone.gate_code import is_too_early_or_late, mac_is_valid, parse_gate_code


def check_gate_code(context: PunchContext) -> RuleResult:
    parsed = parse_gate_code(context.gate_code_text or "")
    if parsed is None or not mac_is_valid(parsed):
        return RuleResult.rejected("GATE_CODE_INVALID")
    scanned_at = context.gate_code_checked_at or context.now
    if is_too_early_or_late(parsed, scanned_at, context.limits.gate_code_seconds):
        return RuleResult.rejected("GATE_CODE_EXPIRED")
    device = context.gate_device
    if (
        device is None
        or device.id != parsed.device_id
        or device.public_key is None
        or device.status != KioskStatus.ACTIVE.value
    ):
        return RuleResult.rejected("GATE_CODE_INVALID")
    # context.plant_id is the employee's plant on the punch date.
    if device.plant_id != context.plant_id:
        return RuleResult.rejected("WRONG_PLANT")
    return RuleResult.passed()
