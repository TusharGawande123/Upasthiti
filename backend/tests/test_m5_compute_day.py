"""The attendance calculation, straight from the golden table (M5 spec §7 rule 22, S-39) and with
Hypothesis property tests (S-43). No database: compute_day() is a pure function."""

from dataclasses import replace
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from app.core.time import IST
from app.modules.attendance.compute import (
    DayEvent,
    DayInputs,
    HolidayInfo,
    LeaveInfo,
    compute_day,
    shift_moments,
)
from app.modules.org.shift_rules_service import ShiftRules

CASES = yaml.safe_load((Path(__file__).parent / "attendance_cases.yaml").read_text("utf-8"))
SHIFTS = {
    "office": ShiftRules(time(9), time(17), 30, 240, 120),
    "night": ShiftRules(time(19), time(7), 30, 240, 120),
    "office_g0": ShiftRules(time(9), time(17), 0, 240, 120),
    "office_m0": ShiftRules(time(9), time(17), 30, 240, 0),
}
DEFAULT_DAY = date(2026, 10, 30)  # a Friday
DEFAULT_NOW = datetime(2026, 11, 20, 12, 0, tzinfo=IST)
WINDOW_BEFORE = timedelta(hours=4)


def window(day: date, rules: ShiftRules) -> tuple[datetime, datetime]:
    """Rule 5 with the same shift on both days: from S − 4 h to the next day's S − 4 h."""
    start, _ = shift_moments(day, rules)
    return start - WINDOW_BEFORE, start - WINDOW_BEFORE + timedelta(days=1)


def parse_event(text: str, day: date) -> DayEvent:
    """'in 09:25', 'out +1 05:30', 'out 16:00 flag', 'in 09:01 fix'."""
    words = text.split()
    direction = words.pop(0)
    event_day = day
    if words[0] == "+1":
        event_day = day + timedelta(days=1)
        words.pop(0)
    moment = datetime.combine(event_day, time.fromisoformat(words.pop(0)), tzinfo=IST)
    return DayEvent(
        time=moment,
        direction=direction,  # type: ignore[arg-type]
        from_correction="fix" in words,
        unchecked_flag="flag" in words,
    )


def inputs_for(case: dict[str, Any]) -> DayInputs:
    day = date.fromisoformat(str(case.get("day", DEFAULT_DAY)))
    rules = SHIFTS[case.get("shift", "office")]
    start, end = window(day, rules)
    return DayInputs(
        day=day,
        employed=case.get("employed", True),
        employee_type=case.get("type", "permanent"),
        day_kind=case.get("kind", "working"),
        rules=rules,
        window_start=start,
        window_end=end,
        events=tuple(parse_event(text, day) for text in case["events"]),
        leave=LeaveInfo("leave-1", is_paid=True) if case.get("leave") else None,
        holiday=HolidayInfo("holiday-1", "Foundation day", True) if case.get("holiday") else None,
        status_override=case.get("status_override"),
        corrected=case.get("corrected", False),
        short_window=case.get("short_window", False),
    )


def now_for(case: dict[str, Any]) -> datetime:
    if "now" not in case:
        return DEFAULT_NOW
    return datetime.fromisoformat(str(case["now"])).replace(tzinfo=IST)


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_golden_case(case: dict[str, Any]) -> None:
    result = compute_day(inputs_for(case), now_for(case))

    for field, expected in case["expect"].items():
        actual = getattr(result, field)
        if field == "exceptions":
            actual = sorted(actual)
            expected = sorted(expected)
        assert actual == expected, f"{case['id']}: {field} is {actual!r}, expected {expected!r}"


def test_every_golden_case_has_a_unique_id() -> None:
    ids = [case["id"] for case in CASES]
    assert len(ids) == len(set(ids))


# --- Properties (S-43) ------------------------------------------------------------------------

minutes_in_window = st.integers(min_value=0, max_value=24 * 60 - 1)


@st.composite
def random_day(draw: st.DrawFn) -> DayInputs:
    rules = draw(st.sampled_from(list(SHIFTS.values())))
    start, end = window(DEFAULT_DAY, rules)
    offsets = draw(st.lists(minutes_in_window, min_size=0, max_size=6))
    directions = draw(st.lists(st.sampled_from(["in", "out"]), min_size=6, max_size=6))
    events = tuple(
        DayEvent(time=start + timedelta(minutes=offset), direction=direction)  # type: ignore[arg-type]
        for offset, direction in zip(offsets, directions, strict=False)
    )
    return DayInputs(
        day=DEFAULT_DAY,
        employed=True,
        employee_type=draw(st.sampled_from(["permanent", "temporary"])),
        day_kind=draw(st.sampled_from(["working", "weekly_off", "holiday"])),
        rules=rules,
        window_start=start,
        window_end=end,
        events=events,
    )


@settings(max_examples=300, deadline=None)
@given(random_day())
def test_stored_day_always_meets_the_database_checks(inputs: DayInputs) -> None:
    """The same rules as the checks on `attendance_days` (spec §6, migration 0022)."""
    result = compute_day(inputs, DEFAULT_NOW)

    assert min(result.worked_min, result.payable_min, result.overtime_min) >= 0
    assert result.payable_min <= result.worked_min
    assert result.overtime_min <= result.payable_min
    if result.status == "incomplete":
        assert result.worked_min == result.overtime_min == result.payable_min == 0
    if inputs.employee_type == "temporary":
        assert result.status not in {"half_day", "short_hours"}
        assert result.late_min == result.early_exit_min == 0
        assert result.status_min is None
    if result.status_min is not None:
        assert result.status_min <= (result.shift_length_min or 0)
    if result.first_in and result.last_out:
        assert result.last_out > result.first_in


@settings(max_examples=200, deadline=None)
@given(random_day())
def test_the_order_of_the_events_does_not_matter(inputs: DayInputs) -> None:
    reversed_inputs = replace(inputs, events=tuple(reversed(inputs.events)))

    assert compute_day(inputs, DEFAULT_NOW) == compute_day(reversed_inputs, DEFAULT_NOW)


@settings(max_examples=200, deadline=None)
@given(random_day())
def test_worked_minutes_are_last_out_minus_first_in(inputs: DayInputs) -> None:
    result = compute_day(inputs, DEFAULT_NOW)

    if result.status not in {"incomplete", "absent", "weekly_off", "holiday"} and result.last_out:
        assert result.first_in is not None
        gap = result.last_out.replace(second=0) - result.first_in.replace(second=0)
        assert result.worked_min == int(gap.total_seconds() // 60)
