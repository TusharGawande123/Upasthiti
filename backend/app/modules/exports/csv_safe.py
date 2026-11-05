"""Turns database values into CSV cells a spreadsheet cannot run as a formula (M6 spec 7.7 rule 8).

A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return can be read by Excel as a
formula ("CSV injection"), for example an employee name typed as `=HYPERLINK(...)`. Such a text is
written with a single quote in front, so the spreadsheet shows it as plain text. Only TEXT values
get the quote: a negative number or a date is not text and stays as it is.
"""

import json
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def safe_text(text: str) -> str:
    """The text, with a quote in front when a spreadsheet could take it for a formula."""
    if text.startswith(FORMULA_STARTS):
        return "'" + text
    return text


def to_cell(value: Any) -> str:
    """One database value as the text of a CSV cell."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return safe_text(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()  # times are stored and exported in UTC
    if isinstance(value, date | time | Decimal | int | float | UUID):
        return str(value)
    if isinstance(value, dict | list | tuple):
        return safe_text(json.dumps(value, default=str, ensure_ascii=False))
    if isinstance(value, bytes | bytearray | memoryview):
        # Binary columns (face data, keys, hashes) are never on the allow-list: stop, do not guess.
        raise ValueError("A binary value must never be exported")
    return safe_text(str(value))  # for example an IP address
