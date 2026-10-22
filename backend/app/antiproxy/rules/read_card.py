"""Step 0: find out WHICH card was scanned, before any rule can refuse the punch.

A test card must never create a punch row (F-27). If the photo rule ran first, a test card
scanned with a dark camera would be refused for its photo, with no card known yet, and be
stored as a rejected punch without an employee. So this step only reads the card kind into
the context; it never refuses anything. The real card checks stay in qr_credential.py.
"""

from sqlalchemy import select

from app.antiproxy.context import PunchContext, RuleResult
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import parse_payload, signature_is_valid


def read_card(context: PunchContext) -> RuleResult:
    parsed = parse_payload(context.qr_text or "")
    if parsed is not None and signature_is_valid(context.app_settings, parsed):
        card = context.session.scalar(
            select(QrCredential).where(QrCredential.card_serial == parsed.serial)
        )
        if card is not None and card.key_id == parsed.key_id:
            context.card = card
    return RuleResult.passed()
