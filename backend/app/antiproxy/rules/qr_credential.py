"""Rule: the scanned card must be a real, working card of an employee of this plant (spec §7.5).

The checks run in a fixed order, so the same bad card always gets the same reason code:
format, signature, (a test card stops here), revoked, not yet valid, expired, employee left,
employee not on QR, wrong plant. The signature proves WE printed the card; everything else
(dates, owner, plant) comes from the database, so the Super Admin can change it any time.
"""

from sqlalchemy import select

from app.antiproxy.context import PunchContext, RuleResult
from app.core.time import to_ist
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.payload import parse_payload, signature_is_valid
from app.modules.qr_cards.states import CardState, card_state


def check_qr_credential(context: PunchContext) -> RuleResult:
    parsed = parse_payload(context.qr_text or "")
    if parsed is None:
        return RuleResult.rejected("QR_FORMAT_INVALID")

    card = context.session.scalar(
        select(QrCredential).where(QrCredential.card_serial == parsed.serial)
    )
    # An unknown serial, an unknown key and a changed signature all look the same from outside,
    # so nobody can find out which serials exist.
    if card is None or card.key_id != parsed.key_id:
        return RuleResult.rejected("QR_SIGNATURE_INVALID")
    if not signature_is_valid(context.app_settings, parsed):
        return RuleResult.rejected("QR_SIGNATURE_INVALID")
    context.card = card

    if card.kind == CardKind.TEST.value and card.revoked_at is None:
        return RuleResult.self_test()

    # With 0 "ending soon" days only the real states come out; an ending card still works.
    state = card_state(card, to_ist(context.now).date(), expiring_soon_days=0)
    if state is CardState.REVOKED:
        return RuleResult.rejected("QR_REVOKED")
    if state is CardState.NOT_YET_VALID:
        return RuleResult.rejected("QR_NOT_YET_VALID")
    if state is CardState.EXPIRED:
        return RuleResult.rejected("QR_EXPIRED")

    # Only a revoked test card gets here without an employee, and it was refused above.
    employee = context.session.get(Employee, card.employee_id) if card.employee_id else None
    if employee is None:
        return RuleResult.rejected("QR_REVOKED")
    context.employee = employee
    if employee.status != EmployeeStatus.ACTIVE.value:
        return RuleResult.rejected("EMPLOYEE_INACTIVE")
    if employee.punch_method != PunchMethod.QR.value:
        return RuleResult.rejected("EMPLOYEE_NOT_QR")
    # A card works only at its owner's plant (decision 0009).
    if employee.plant_id != context.kiosk.plant_id:
        return RuleResult.rejected("WRONG_PLANT")
    return RuleResult.passed()
