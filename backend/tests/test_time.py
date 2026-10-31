"""UTC/IST time helpers."""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.time import to_ist, today_ist, utc_now
from tests.clock_helpers import PINNED_DAY, frozen_at, ist


def test_utc_now_is_timezone_aware_utc() -> None:
    assert utc_now().utcoffset() == timedelta(0)


def test_to_ist_adds_five_and_a_half_hours() -> None:
    midnight_utc = datetime(2026, 10, 12, 0, 30, tzinfo=UTC)

    in_ist = to_ist(midnight_utc)

    assert (in_ist.hour, in_ist.minute) == (6, 0)
    assert in_ist.utcoffset() == timedelta(hours=5, minutes=30)


def test_to_ist_rejects_a_time_without_timezone() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        to_ist(datetime(2026, 10, 12, 6, 0))


def test_frozen_clock_moves_utc_now_and_today_ist_everywhere() -> None:
    # 23:59 IST on the pinned day is still that day in IST, though UTC is 18:29.
    with frozen_at(ist(PINNED_DAY, 23, 59)) as clock:
        assert today_ist() == PINNED_DAY
        assert utc_now() == datetime(2026, 10, 28, 18, 29, tzinfo=UTC)
        clock.shift(timedelta(minutes=2))
        assert today_ist() == PINNED_DAY + timedelta(days=1)


def test_frozen_clock_needs_a_timezone() -> None:
    with pytest.raises(ValueError, match="timezone-aware"), frozen_at(datetime(2026, 10, 28)):
        pass
