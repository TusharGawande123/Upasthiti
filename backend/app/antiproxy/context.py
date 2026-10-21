"""What every anti-proxy rule gets to read and write (spec M2 §7 rules 4-8).

A rule looks at the punch (`PunchContext`) and answers with a `RuleResult`: pass, reject with
one reason code, or "self test" (a test card was scanned, which is not a punch at all).
Rules also fill in what they found (the checked photo, the card, the employee, IN or OUT), so
later rules and the endpoint do not have to look it up again.
"""

import enum
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Direction
from app.modules.punches.snapshots import CheckedSnapshot
from app.modules.qr_cards.models import QrCredential


class Outcome(enum.StrEnum):
    ALLOW = "allow"  # no objection; the next rule runs (after the last rule: accepted)
    REJECT = "reject"  # the punch is refused, with a reason code
    SELF_TEST = "self_test"  # a test card: show "Kiosk OK", make no punch


@dataclass(frozen=True)
class RuleResult:
    outcome: Outcome
    reason_code: str | None = None

    def __post_init__(self) -> None:
        # A refusal without a reason could never be stored or shown, so it cannot exist.
        if self.outcome is Outcome.REJECT and not self.reason_code:
            raise ValueError("A rejecting rule must give a reason code")

    @classmethod
    def passed(cls) -> RuleResult:
        return cls(Outcome.ALLOW)

    @classmethod
    def rejected(cls, reason_code: str) -> RuleResult:
        return cls(Outcome.REJECT, reason_code)

    @classmethod
    def self_test(cls) -> RuleResult:
        return cls(Outcome.SELF_TEST)


@dataclass(frozen=True)
class PunchLimits:
    """The settings the rules need, read once per punch by the endpoint (the Super Admin edits
    them). A rule never reads the settings table itself."""

    punch_cooldown_minutes: int
    min_minutes_before_out: int
    open_in_max_hours: int
    snapshot_dark_threshold: int


@dataclass
class PunchContext:
    # What the server knows and trusts.
    session: Session
    app_settings: Settings
    kiosk: KioskDevice
    now: datetime  # the server clock; the kiosk's own clock is never used for a decision
    limits: PunchLimits
    # What the kiosk sent (untrusted).
    qr_text: str | None
    snapshot_bytes: bytes | None
    # What the rules find out, in order.
    snapshot: CheckedSnapshot | None = None
    card: QrCredential | None = None
    employee: Employee | None = None
    direction: Direction | None = None
