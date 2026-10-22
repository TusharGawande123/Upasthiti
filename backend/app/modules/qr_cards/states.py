"""The state of a card, worked out from its dates on the day (spec §7 rule 3). Never stored.

Order of the checks: revoked, not yet valid, expired, ending soon, active. Validity counts by
IST calendar day and both end days are included.
"""

import enum
from datetime import date, timedelta

from app.modules.qr_cards.models import QrCredential


class CardState(enum.StrEnum):
    NONE = "none"  # the employee has no card (used by the list only)
    REVOKED = "revoked"
    NOT_YET_VALID = "not_yet_valid"
    EXPIRED = "expired"
    EXPIRING = "expiring"  # works, but ends within `expiring_soon_days`
    ACTIVE = "active"


def card_state(card: QrCredential, today: date, expiring_soon_days: int) -> CardState:
    if card.revoked_at is not None:
        return CardState.REVOKED
    if today < card.valid_from:
        return CardState.NOT_YET_VALID
    if today > card.valid_until:
        return CardState.EXPIRED
    if card.valid_until <= today + timedelta(days=expiring_soon_days):
        return CardState.EXPIRING
    return CardState.ACTIVE


def works_today(state: CardState) -> bool:
    """Whether the kiosk accepts the card (an ending-soon card still works)."""
    return state in (CardState.ACTIVE, CardState.EXPIRING)
