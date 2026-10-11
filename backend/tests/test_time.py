"""UTC/IST time helpers."""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.time import to_ist, utc_now


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
