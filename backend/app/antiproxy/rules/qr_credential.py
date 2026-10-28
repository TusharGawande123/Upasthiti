"""Rule: the scanned card must be a real, working card of an employee of this plant (spec §7.5).

The checks run in a fixed order, so the same bad card always gets the same reason code:
format, signature, (a test card stops here), revoked, not yet valid, expired, employee left,
employee not on QR, wrong plant. The signature proves WE printed the card; everything else
(dates, owner, plant) comes from the database, so the Super Admin can change it any time.
"""

import logging

from sqlalchemy import select

from app.antiproxy.context import PunchContext, RuleResult
from app.antiproxy.facts_at_time import card_was_revoked, employee_plant_on, employee_was_active
from app.core.time import to_ist
from app.modules.employees.models import Employee, PunchMethod
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.payload import parse_payload, signature_is_valid

logger = logging.getLogger(__name__)


def check_qr_credential(context: PunchContext) -> RuleResult:
    parsed = parse_payload(context.qr_text or "")
    if parsed is None:
        return RuleResult.rejected("QR_FORMAT_INVALID")

    if not signature_is_valid(context.app_settings, parsed):
        return RuleResult.rejected("QR_SIGNATURE_INVALID")
    card = context.session.scalar(
        select(QrCredential).where(QrCredential.card_serial == parsed.serial)
    )
    # A forged text and an unknown serial look the same from outside, so nobody can find out
    # which serials exist. A VALID signature on an unknown serial is different: only someone
    # holding our signing key can make it, so it is logged as an error for the admin.
    if card is None:
        logger.error("A card text with a valid signature names an unknown serial")
        return RuleResult.rejected("QR_SIGNATURE_INVALID")
    if card.key_id != parsed.key_id:
        return RuleResult.rejected("QR_SIGNATURE_INVALID")
    context.card = card

    if card.kind == CardKind.TEST.value and card.revoked_at is None:
        return RuleResult.self_test()

    # The dates are judged on the IST day of the punch time; an offline punch with a proven time
    # is judged as things were then (M4 §7 rule 5, facts_at_time.py).
    day = to_ist(context.now).date()
    at_punch_time = context.judges_at_punch_time
    if card_was_revoked(card, context.now, at_punch_time):
        return RuleResult.rejected("QR_REVOKED")
    if day < card.valid_from:
        return RuleResult.rejected("QR_NOT_YET_VALID")
    if day > card.valid_until:
        return RuleResult.rejected("QR_EXPIRED")

    # Only a revoked test card gets here without an employee, and it was refused above.
    employee = context.session.get(Employee, card.employee_id) if card.employee_id else None
    if employee is None:
        return RuleResult.rejected("QR_REVOKED")
    context.employee = employee
    if not employee_was_active(employee, day, at_punch_time):
        return RuleResult.rejected("EMPLOYEE_INACTIVE")
    if employee.punch_method != PunchMethod.QR.value:
        return RuleResult.rejected("EMPLOYEE_NOT_QR")
    # A card works only at its owner's plant (decision 0009).
    if employee_plant_on(context.session, employee, day, at_punch_time) != context.kiosk.plant_id:
        return RuleResult.rejected("WRONG_PLANT")
    return RuleResult.passed()
