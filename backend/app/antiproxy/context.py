"""What every anti-proxy rule gets to read and write (spec M2 §7 rules 4-8).

A rule looks at the punch (`PunchContext`) and answers with a `RuleResult`: pass, reject with
one reason code, flag with one code (M4: the punch counts, but the Super Admin should look at it),
or "self test" (a test card was scanned, which is not a punch at all).
Rules also fill in what they found (the checked photo, the card, the employee, IN or OUT), so
later rules and the endpoint do not have to look it up again.
"""

import enum
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.employees.models import Employee
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Direction
from app.modules.punches.snapshots import CheckedSnapshot
from app.modules.qr_cards.models import QrCredential


class Outcome(enum.StrEnum):
    ALLOW = "allow"  # no objection; the next rule runs (after the last rule: accepted)
    REJECT = "reject"  # the punch is refused, with a reason code
    FLAG = "flag"  # M4: no objection, but a person should look (the next rule still runs)
    SELF_TEST = "self_test"  # a test card: show "Kiosk OK", make no punch


@dataclass(frozen=True)
class RuleResult:
    outcome: Outcome
    reason_code: str | None = None

    def __post_init__(self) -> None:
        # A refusal without a reason could never be stored or shown, so it cannot exist.
        if self.outcome in (Outcome.REJECT, Outcome.FLAG) and not self.reason_code:
            raise ValueError("A rejecting or flagging rule must give a code")

    @classmethod
    def passed(cls) -> RuleResult:
        return cls(Outcome.ALLOW)

    @classmethod
    def rejected(cls, reason_code: str) -> RuleResult:
        return cls(Outcome.REJECT, reason_code)

    @classmethod
    def flagged(cls, flag_code: str) -> RuleResult:
        return cls(Outcome.FLAG, flag_code)

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
    # M4 (spec §7 rule 17)
    location_max_age_seconds: int = 120
    impossible_travel_kmh: int = 60
    impossible_travel_min_distance_m: int = 500
    same_person_two_devices_minutes: int = 10


@dataclass
class PunchContext:
    # What the server knows and trusts.
    session: Session
    app_settings: Settings
    kiosk: KioskDevice
    # The punch time: the server clock for a live punch, the proven time for an offline one
    # (M4). The kiosk's own clock is never used for a decision.
    now: datetime
    limits: PunchLimits
    # What the kiosk sent (untrusted).
    qr_text: str | None
    snapshot_bytes: bytes | None
    location: Location | None = None
    location_age_s: int | None = None
    is_offline: bool = False  # M4: a queued punch decided at sync
    # What the rules find out, in order.
    snapshot: CheckedSnapshot | None = None
    card: QrCredential | None = None
    employee: Employee | None = None
    direction: Direction | None = None
    # M4: what the location and flag rules found (stored on the punch row).
    geofence_id: uuid.UUID | None = None
    geofence_distance_m: float | None = None
    related_punch_id: uuid.UUID | None = None
