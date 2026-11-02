"""One check for "from date to date" ranges that must not be too long."""

from datetime import date

from app.core.errors import ApiError


def check_date_range(date_from: date, date_to: date, max_days: int) -> None:
    """The end must not be before the start, and the range holds at most `max_days` days (both
    ends count). The too-long answer is always `REPORT_RANGE_TOO_LONG`."""
    if date_to < date_from:
        raise ApiError(
            "VALIDATION_FAILED", "The end is before the start.", 422, {"field": "date_to"}
        )
    if (date_to - date_from).days + 1 > max_days:
        raise ApiError(
            "REPORT_RANGE_TOO_LONG",
            f"Choose at most {max_days} days.",
            422,
            {"field": "date_to", "max_days": max_days},
        )
