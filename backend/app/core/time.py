"""Time helpers: the server always works in UTC and converts to IST only for display.

Rule (CLAUDE.md §10): all timestamps are stored in UTC and shown in IST (Asia/Kolkata).
The server never trusts a client's clock, so "now" always comes from utc_now().
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def utc_now() -> datetime:
    """The current server time, timezone-aware, in UTC."""
    return datetime.now(UTC)


def to_ist(moment: datetime) -> datetime:
    """Convert a timezone-aware datetime to IST.

    A naive datetime (no timezone) is rejected: we cannot know if it was UTC or IST, and
    guessing wrong would shift attendance times by 5.5 hours.
    """
    if moment.tzinfo is None:
        raise ValueError("to_ist() needs a timezone-aware datetime")
    return moment.astimezone(IST)
