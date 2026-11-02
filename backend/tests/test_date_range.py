"""The one date-range check used by the corrections and attendance lists."""

from datetime import date

import pytest

from app.core.date_range import check_date_range
from app.core.errors import ApiError

FIRST = date(2026, 10, 1)


def test_a_range_of_exactly_the_maximum_is_fine() -> None:
    check_date_range(FIRST, date(2026, 12, 31), 92)  # 31 + 30 + 31 = 92 days


def test_one_day_too_long_says_report_range_too_long() -> None:
    with pytest.raises(ApiError) as error:
        check_date_range(FIRST, date(2027, 1, 1), 92)
    assert error.value.code == "REPORT_RANGE_TOO_LONG"
    assert error.value.status_code == 422


def test_an_end_before_the_start_is_a_validation_error() -> None:
    with pytest.raises(ApiError) as error:
        check_date_range(date(2026, 10, 2), FIRST, 92)
    assert error.value.code == "VALIDATION_FAILED"
