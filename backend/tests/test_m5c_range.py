# ruff: noqa: F811  (the `world` fixture is imported from the other attendance test)
"""Attendance over a date range (M5c spec §5.1, §7.1; AC-1 to AC-3, AC-6 to AC-11; plan slice D).

Real PostgreSQL, fake data, the clock pinned to Mon 02/11/2026 12:00 IST (the same world as the
other attendance read tests).
"""

from collections.abc import Iterator
from datetime import date

import pytest
from sqlalchemy import func, select, update

from app.modules.attendance import service
from app.modules.attendance.models import AttendanceDay
from tests.clock_helpers import frozen_at
from tests.test_m5_attendance_api import (  # noqa: F401  (world is a fixture)
    FRIDAY,
    MONDAY,
    NOW,
    work_a_day,
    world,
)

REGISTER_RANGE = "/api/v1/attendance/register-range"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


def register_range(world: dict, who: str, date_from: str, date_to: str, **params: object):
    return world[who].get(
        REGISTER_RANGE,
        params={
            "date_from": date_from,
            "date_to": date_to,
            "plant_id": world["plant"].id,
        }
        | params,
    )


def employee_range(world: dict, who: str, code: str, date_from: str, date_to: str):
    return world[who].get(
        f"/api/v1/attendance/employee/{world['people'][code]}/range",
        params={"date_from": date_from, "date_to": date_to},
    )


def test_a_sixty_day_register_has_a_cell_for_every_day_and_totals(world: dict) -> None:
    """AC-1: every employee has 60 cells (days before the plant started show a dash)."""
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))

    response = register_range(world, "head", "2026-09-04", "2026-11-02")

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["days"]) == 60
    assert body["days"][0] == {"date": "2026-09-04", "weekday": 5}
    assert {item["employee"]["code"] for item in body["items"]} == {"P-1", "P-2", "T-1"}
    for item in body["items"]:
        assert len(item["days"]) == 60
        assert item["days"][0]["code"] == "–"  # before the plant's attendance start date
    first = next(item for item in body["items"] if item["employee"]["code"] == "P-1")
    assert first["totals"]["present"] == 1
    assert body["preparing"] == {"pending_days": 0}


def test_a_range_over_93_days_or_the_wrong_way_round_is_refused(world: dict) -> None:
    """AC-2, and the shared messages of the date checks."""
    too_long = register_range(world, "head", "2026-08-01", "2026-11-02")  # 94 days
    backwards = register_range(world, "head", "2026-11-02", "2026-11-01")
    future = register_range(world, "head", "2026-11-03", "2026-11-05")
    exactly_93 = register_range(world, "head", "2026-08-02", "2026-11-02")

    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"
    assert too_long.json()["error"]["details"]["max_days"] == 93
    assert backwards.json()["error"]["code"] == "VALIDATION_FAILED"
    assert future.json()["error"]["code"] == "ATTENDANCE_DATE_INVALID"
    assert exactly_93.status_code == 200


def test_the_end_of_a_range_is_cut_to_today(world: dict) -> None:
    response = register_range(world, "head", "2026-10-30", "2026-11-20")

    assert response.status_code == 200
    assert response.json()["date_to"] == "2026-11-02"
    assert len(response.json()["items"][0]["days"]) == 4


def test_a_plant_head_cannot_read_another_plants_range(world: dict) -> None:
    """AC-3."""
    own = register_range(world, "head", "2026-10-26", "2026-11-02")
    stranger = register_range(world, "other_head", "2026-10-26", "2026-11-02")
    stranger_employee = employee_range(world, "other_head", "P-1", "2026-10-26", "2026-11-02")

    assert own.status_code == 200
    assert stranger.status_code == 404
    assert stranger_employee.status_code == 404


def test_one_employee_366_days_works_and_367_is_refused(world: dict) -> None:
    """AC-9."""
    ok = employee_range(world, "boss", "P-1", "2025-11-02", "2026-11-02")  # 366 days
    too_long = employee_range(world, "boss", "P-1", "2025-11-01", "2026-11-02")

    assert ok.status_code == 200, ok.text
    assert too_long.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"
    assert too_long.json()["error"]["details"]["max_days"] == 366


def test_an_employee_range_lists_the_days_and_the_totals_add_up(world: dict) -> None:
    """AC-7: totals equal what the rows say."""
    work_a_day(world, "P-1", date(2026, 10, 27), (9, 0), (17, 0))
    work_a_day(world, "P-1", date(2026, 10, 28), (9, 45), (17, 0))  # late
    work_a_day(world, "T-1", date(2026, 10, 27), (9, 0), (20, 0))  # overtime, temporary

    permanent = employee_range(world, "head", "P-1", "2026-10-26", "2026-11-02").json()
    temporary = employee_range(world, "head", "T-1", "2026-10-26", "2026-11-02").json()

    statuses = [day["status"] for day in permanent["days"]]
    for status in ("present", "half_day", "absent"):
        assert permanent["totals"][status] == statuses.count(status)
    assert statuses.count("present") + statuses.count("half_day") == 2
    assert permanent["totals"]["late_count"] == sum(
        1 for day in permanent["days"] if day["late_min"]
    )
    assert permanent["totals"]["worked_min"] == sum(day["worked_min"] for day in permanent["days"])
    assert temporary["totals"]["overtime_min"] == sum(
        day["overtime_min"] for day in temporary["days"]
    )
    assert temporary["totals"]["overtime_min"] > 0
    assert permanent["employee"]["code"] == "P-1"


def test_leave_shows_but_its_reason_never_does(world: dict) -> None:
    """AC-10: the range answer holds the leave, not the reason."""
    made = world["boss"].post(
        "/api/v1/leave",
        json={
            "employee_id": str(world["people"]["P-1"]),
            "from_date": "2026-10-29",
            "to_date": "2026-10-29",
            "is_paid": True,
            "reason": "Family function",
        },
    )
    assert made.status_code == 201, made.text

    for who in ("head", "corporate", "boss"):
        response = employee_range(world, who, "P-1", "2026-10-26", "2026-11-02")
        assert "Family function" not in response.text
    leave_day = next(
        day
        for day in employee_range(world, "head", "P-1", "2026-10-26", "2026-11-02").json()["days"]
        if day["date"] == "2026-10-29"
    )
    assert leave_day["leave"]["is_paid"] is True


def test_a_conversion_in_the_range_shows_the_type_change_and_split_totals(world: dict) -> None:
    """AC-19, AC-20: days before the conversion stay temporary."""
    for day in (date(2026, 10, 27), date(2026, 10, 30)):
        work_a_day(world, "T-1", day, (9, 0), (17, 0))
    converted = world["boss"].post(
        f"/api/v1/employees/{world['people']['T-1']}/convert-to-permanent",
        json={"effective_from": "2026-10-29", "reason": "Permanent offer"},
    )
    assert converted.status_code == 200, converted.text

    body = employee_range(world, "boss", "T-1", "2026-10-26", "2026-11-02").json()

    kinds = {day["date"]: day["employee_type"] for day in body["days"]}
    assert kinds["2026-10-28"] == "temporary"
    assert kinds["2026-10-29"] == "permanent"
    assert [change["type"] for change in body["type_changes"]] == ["temporary", "permanent"]
    assert body["type_changes"][1]["from_date"] == "2026-10-29"
    assert set(body["totals_by_type"]) == {"temporary", "permanent"}
    assert body["totals_by_type"]["temporary"]["present"] == 1
    assert body["totals_by_type"]["permanent"]["present"] == 1


def test_a_long_range_recomputes_in_steps_and_says_how_many_days_are_left(world: dict) -> None:
    """AC-6: with a small budget the first read answers 'still getting ready', the next ones
    finish it; nothing is half-wrong."""
    session = world["session"]
    ids = list(world["people"].values())
    service.ensure_fresh(session, ids, date(2026, 10, 26), MONDAY, NOW)
    session.execute(
        update(AttendanceDay).where(AttendanceDay.employee_id.in_(ids)).values(stale=True)
    )
    session.commit()
    stale_total = session.scalar(
        select(func.count())
        .select_from(AttendanceDay)
        .where(AttendanceDay.stale, AttendanceDay.employee_id.in_(ids))
    )
    assert stale_total and stale_total > 4

    first = service.ensure_fresh_within_budget(
        session, ids, date(2026, 10, 26), MONDAY, NOW, max_days=3
    )
    second = service.ensure_fresh_within_budget(
        session, ids, date(2026, 10, 26), MONDAY, NOW, max_days=3
    )
    finished = service.ensure_fresh_within_budget(session, ids, date(2026, 10, 26), MONDAY, NOW)

    assert first == stale_total - 3
    assert second == stale_total - 6
    assert finished == 0


def test_a_download_style_read_never_leaves_a_stale_day_behind(world: dict) -> None:
    """After a normal read of a short range nothing in it is stale any more."""
    work_a_day(world, "P-2", FRIDAY, (9, 0), (17, 0))
    register_range(world, "head", "2026-10-26", "2026-11-02")

    session = world["session"]
    session.expire_all()
    left = session.scalar(
        select(func.count())
        .select_from(AttendanceDay)
        .where(AttendanceDay.stale, AttendanceDay.employee_id.in_(list(world["people"].values())))
    )
    assert left == 0
