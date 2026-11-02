"""Attendance read endpoints (M5 spec §5.1; AC-6d, AC-10, AC-12, AC-22, AC-31).
Real PostgreSQL, fake data, the clock pinned to Mon 02/11/2026 12:00 IST."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import PlantWeeklyOff
from app.modules.punches.models import Punch, PunchReview
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

MONDAY = date(2026, 11, 2)
SATURDAY = date(2026, 10, 31)
SUNDAY = date(2026, 11, 1)
FRIDAY = date(2026, 10, 30)
NOW = ist(MONDAY, 12, 0)


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


def make_plant(boss: TestClient, session: Session, code: str) -> PlantIds:
    """A plant that has used attendance since 26/10, with Sunday as the weekly off from then (a
    new plant's own Sunday starts on its creation day, which is "today" in these tests)."""
    plant = create_plant(boss, session, code)
    boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-26"})
    session.add(
        PlantWeeklyOff(
            plant_id=uuid.UUID(plant.id),
            weekday=7,
            effective_from=date(2026, 10, 1),
            created_at=ist(date(2026, 10, 1), 12),
        )
    )
    session.commit()
    return plant


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant = make_plant(boss, db_session, "K134")
    demo = make_plant(boss, db_session, "DEMO1")
    shift = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
    ).json()
    people = {}
    for code, kind in (("P-1", "permanent"), ("P-2", "permanent"), ("T-1", "temporary")):
        body = permanent_body(plant, code=code, name=f"Person {code}") | {
            "shift_id": shift["id"],
            "joined_on": "2026-10-26",
        }
        if kind == "temporary":
            body |= {"type": "temporary", "hourly_rate": "85.00", "category_id": plant.helper_id}
        people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
    demo_body = permanent_body(demo, code="D-1") | {"joined_on": "2026-10-26"}
    boss.post("/api/v1/employees", json=demo_body)
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    other_head = client_for(db_app, db_session, Role.PLANT_HEAD, "other_head")
    other = make_plant(boss, db_session, "K200")
    for username, item in (("head", plant), ("other_head", other)):
        user = db_session.scalars(select(User).where(User.username == username)).one()
        set_user_plant(db_session, user, uuid.UUID(item.id))
    db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "other_head": other_head,
        "corporate": client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp"),
        "plant": plant,
        "people": people,
        "kiosk": make_active_kiosk(db_session, plant, Device()),
        "session": db_session,
    }


def punch(world: dict, code: str, moment: datetime, direction: str) -> Punch:
    kiosk: KioskDevice = world["kiosk"]
    row = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=world["people"][code],
        method="face",
        direction=direction,
        decision="accepted",
        reason_codes=[],
        server_received_at=moment,
        was_offline=False,
    )
    world["session"].add(row)
    world["session"].commit()
    return row


def work_a_day(world: dict, code: str, day: date, start: tuple, end: tuple) -> None:
    punch(world, code, ist(day, *start), "in")
    punch(world, code, ist(day, *end), "out")


def daily(world: dict, who: str, day: date, **params: object):
    return world[who].get(
        "/api/v1/attendance/daily",
        params={"date": day.isoformat(), "plant_id": world["plant"].id} | params,
    )


def test_the_daily_list_shows_each_person_with_the_day(world: dict) -> None:
    work_a_day(world, "P-1", FRIDAY, (9, 25), (17, 0))
    work_a_day(world, "T-1", FRIDAY, (8, 30), (19, 30))

    response = daily(world, "boss", FRIDAY)

    assert response.status_code == 200, response.text
    items = {item["employee"]["code"]: item["day"] for item in response.json()["items"]}
    assert items["P-1"]["status"] == "present" and items["P-1"]["code"] == "P"
    assert items["P-1"]["worked_min"] == 455
    assert items["P-2"]["status"] == "absent" and items["P-2"]["code"] == "A"
    assert (items["T-1"]["worked_min"], items["T-1"]["overtime_min"]) == (660, 150)
    assert items["T-1"]["payable_min"] == 630


def test_daily_filters_and_future_dates(world: dict) -> None:
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))

    absent = daily(world, "boss", FRIDAY, status="absent", type="permanent").json()
    searched = daily(world, "boss", FRIDAY, q="p-1").json()
    future = daily(world, "boss", date(2026, 11, 3))

    assert [item["employee"]["code"] for item in absent["items"]] == ["P-2"]
    assert searched["total"] == 1
    assert future.json()["error"]["code"] == "ATTENDANCE_DATE_INVALID"


def test_the_register_has_codes_and_month_totals(world: dict) -> None:
    """AC-10: a Sunday with no punches is WO, never Absent; worked on a Sunday is WO-W."""
    work_a_day(world, "P-1", FRIDAY, (9, 40), (17, 0))  # half day
    work_a_day(world, "P-1", SUNDAY, (10, 0), (14, 0))  # worked on the weekly off

    response = world["boss"].get(
        "/api/v1/attendance/register",
        params={"month": "2026-11", "plant_id": world["plant"].id},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["days_in_month"] == 30 and body["total"] == 3
    rows = {row["employee"]["code"]: row for row in body["items"]}
    november = {cell["date"]: cell["code"] for cell in rows["P-1"]["days"]}
    assert november["2026-11-01"] == "WO-W"
    assert november["2026-11-02"] == "…"  # today, 12:00, nobody has punched
    assert november["2026-11-05"] == "–"  # the future is never stored
    assert rows["P-2"]["days"][0]["code"] == "WO"
    assert rows["P-1"]["totals"]["worked_on_off_day"] == 1
    october = (
        world["boss"]
        .get(
            "/api/v1/attendance/register",
            params={"month": "2026-10", "plant_id": world["plant"].id},
        )
        .json()
    )
    p1 = next(row for row in october["items"] if row["employee"]["code"] == "P-1")
    assert p1["totals"]["half_day"] == 1 and p1["totals"]["late_count"] == 1
    assert p1["totals"]["late_min"] == 40


def test_the_undecided_count_follows_the_decisions(world: dict) -> None:
    """AC-6d: Short hours and Incomplete days wait for the Super Admin; deciding lowers the count"""
    work_a_day(world, "P-1", FRIDAY, (9, 0), (12, 50))  # Short hours
    punch(world, "P-2", ist(FRIDAY, 9, 0), "in")  # no OUT: Incomplete
    params = {"date_from": "2026-10-26", "date_to": "2026-11-02", "plant_id": world["plant"].id}

    before = world["boss"].get("/api/v1/attendance/undecided", params=params).json()
    world["boss"].post(
        "/api/v1/regularisations",
        json={
            "employee_id": str(world["people"]["P-1"]),
            "attendance_date": FRIDAY.isoformat(),
            "kind": "set_status",
            "status_value": "half_day",
            "reason": "Doctor visit",
        },
    )
    world["boss"].post(
        "/api/v1/regularisations",
        json={
            "employee_id": str(world["people"]["P-2"]),
            "attendance_date": FRIDAY.isoformat(),
            "kind": "add_punch",
            "direction": "out",
            "out_time": ist(FRIDAY, 17, 5).isoformat(),
            "reason": "Forgot to punch out",
        },
    )
    after = world["boss"].get("/api/v1/attendance/undecided", params=params).json()

    assert (before["short_hours"], before["incomplete"]) == (1, 1)
    assert before["plants"][0]["plant"]["code"] == "K134"
    assert (after["short_hours"], after["incomplete"]) == (0, 0)
    long_range = world["boss"].get(
        "/api/v1/attendance/undecided",
        params={"date_from": "2026-01-01", "date_to": "2026-11-02"},
    )
    assert long_range.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"


def test_the_day_timeline_shows_punches_reviews_and_corrections(world: dict) -> None:
    """AC-22: an M4 approval and a correction on one day show together; the Corporate Head sees
    the approval without its reason."""
    punch(world, "P-1", ist(FRIDAY, 9, 0), "in")
    rejected = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=world["kiosk"].id,
        plant_id=world["kiosk"].plant_id,
        employee_id=world["people"]["P-1"],
        method="face",
        decision="rejected",
        reason_codes=["FACE_NO_MATCH"],
        server_received_at=ist(FRIDAY, 17, 1),
        was_offline=False,
    )
    world["session"].add(rejected)
    world["session"].flush()
    boss_id = world["session"].scalars(select(User.id).where(User.username == "boss")).one()
    world["session"].add(
        PunchReview(
            punch_id=rejected.id,
            action="approved",
            direction="out",
            employee_id=world["people"]["P-1"],
            reason="Checked the photo",
            reviewed_by=boss_id,
            reviewed_at=ist(FRIDAY, 18, 0),
        )
    )
    world["session"].commit()
    world["head"].post(
        "/api/v1/regularisations",
        json={
            "employee_id": str(world["people"]["P-1"]),
            "attendance_date": FRIDAY.isoformat(),
            "kind": "set_status",
            "status_value": "present",
            "reason": "Overtime was approved",
        },
    )
    url = f"/api/v1/attendance/employee/{world['people']['P-1']}/day/{FRIDAY}"

    detail = world["boss"].get(url).json()
    seen_by_corporate = world["corporate"].get(url).json()

    assert (
        detail["day"]["status"] == "present" and detail["day"]["worked_min"] == 481
    )  # 09:00 to the approved OUT 17:01
    kinds = [item["kind"] for item in detail["timeline"]]
    assert kinds.count("punch") == 2 and "review" in kinds and "correction" in kinds
    roles = {item["role"] for item in detail["timeline"] if item["kind"] == "punch"}
    assert roles == {"first_in", "last_out"}
    review_of = lambda body: next(i for i in body["timeline"] if i["kind"] == "review")  # noqa: E731
    assert review_of(detail)["reason"] == "Checked the photo"
    assert review_of(seen_by_corporate)["reason"] is None
    assert detail["can_correct"] is True and seen_by_corporate["can_request"] is True
    assert detail["shift_rules"]["grace_min"] == 30
    assert "set_status" in detail["allowed_correction_kinds"]


def test_the_corrections_screen_and_the_punch_approvals_list_agree(world: dict) -> None:
    punch(world, "P-1", ist(FRIDAY, 9, 0), "in")
    rejected = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=world["kiosk"].id,
        plant_id=world["kiosk"].plant_id,
        method="face",
        decision="rejected",
        reason_codes=["FACE_NO_MATCH"],
        server_received_at=ist(FRIDAY, 17, 1),
        was_offline=False,
    )
    world["session"].add(rejected)
    world["session"].flush()
    boss_id = world["session"].scalars(select(User.id).where(User.username == "boss")).one()
    world["session"].add(
        PunchReview(
            punch_id=rejected.id,
            action="approved",
            direction="out",
            employee_id=world["people"]["P-1"],
            reason="It is him",
            reviewed_by=boss_id,
            reviewed_at=ist(FRIDAY, 18, 0),
        )
    )
    world["session"].commit()
    params = {"date_from": "2026-10-30", "date_to": "2026-10-30"}

    as_boss = world["boss"].get("/api/v1/punch-approvals", params=params).json()
    as_head = world["head"].get("/api/v1/punch-approvals", params=params).json()
    other_plant = world["other_head"].get("/api/v1/punch-approvals", params=params).json()

    assert as_boss["total"] == 1
    assert as_boss["items"][0]["reason"] == "It is him"
    assert as_boss["items"][0]["employee"]["code"] == "P-1"
    assert as_head["items"][0]["reason"] is None
    assert other_plant["total"] == 0


def test_demo_plants_are_hidden_unless_the_super_admin_asks(world: dict) -> None:
    params = {"date": FRIDAY.isoformat()}

    default = world["boss"].get("/api/v1/attendance/daily", params=params).json()
    with_demo = (
        world["boss"]
        .get("/api/v1/attendance/daily", params=params | {"include_demo": "true"})
        .json()
    )
    corporate_asks = (
        world["corporate"]
        .get("/api/v1/attendance/daily", params=params | {"include_demo": "true"})
        .json()
    )

    codes = lambda body: {item["employee"]["code"] for item in body["items"]}  # noqa: E731
    assert "D-1" not in codes(default)
    assert "D-1" in codes(with_demo)
    assert "D-1" not in codes(corporate_asks)  # only the Super Admin may include them


def test_a_plant_head_reads_only_the_own_plant(world: dict) -> None:
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))
    day_url = f"/api/v1/attendance/employee/{world['people']['P-1']}/day/{FRIDAY}"
    month_url = f"/api/v1/attendance/employee/{world['people']['P-1']}"

    own = world["head"].get(day_url)
    stranger = world["other_head"].get(day_url)
    stranger_month = world["other_head"].get(month_url, params={"month": "2026-10"})
    foreign_register = world["other_head"].get(
        "/api/v1/attendance/register",
        params={"month": "2026-10", "plant_id": world["plant"].id},
    )

    assert own.status_code == 200
    assert stranger.json()["error"]["code"] == "NOT_FOUND"
    assert stranger_month.json()["error"]["code"] == "NOT_FOUND"
    assert foreign_register.json()["error"]["code"] == "NOT_FOUND"
    month = world["head"].get(month_url, params={"month": "2026-10"}).json()
    assert month["totals"]["present"] == 1
    assert month["employee"]["code"] == "P-1"


def test_recompute_is_for_the_super_admin_and_limited_to_62_days(world: dict) -> None:
    body = {"plant_id": world["plant"].id, "date_from": "2026-10-26", "date_to": "2026-10-30"}

    ok = world["boss"].post("/api/v1/attendance/recompute", json=body)
    forbidden = world["corporate"].post("/api/v1/attendance/recompute", json=body)
    too_long = world["boss"].post(
        "/api/v1/attendance/recompute", json=body | {"date_from": "2026-08-01"}
    )

    assert ok.status_code == 202 and ok.json()["days_marked"] >= 15  # 3 people × 5 days
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert too_long.json()["error"]["code"] == "RECOMPUTE_RANGE_TOO_LONG"


def explanation_of(world: dict, code: str, day: date) -> list[dict]:
    url = f"/api/v1/attendance/employee/{world['people'][code]}/day/{day}"
    response = world["boss"].get(url)
    assert response.status_code == 200, response.text
    return response.json()["explanation"]


def test_explain_this_day_for_a_late_day_and_for_overtime_below_the_minimum(world: dict) -> None:
    """AC-47 (F-61): the sentences come from the computed day, as translation keys with values."""
    work_a_day(world, "P-1", FRIDAY, (9, 40), (17, 0))
    work_a_day(world, "P-2", FRIDAY, (9, 0), (18, 50))

    late = {item["key"]: item["values"] for item in explanation_of(world, "P-1", FRIDAY)}
    assert late["late"]["minutes"] == 40 and late["late"]["until"] == "09:30"
    assert late["late"]["time"] == "09:40" and late["outAt"]["time"] == "17:00"
    assert late["workedForStatus"]["worked"] == "7 h 20 m"
    assert late["workedForStatus"]["full"] == "8 h"
    assert "overtimeReached" not in late

    near = {item["key"]: item["values"] for item in explanation_of(world, "P-2", FRIDAY)}
    assert near["onTime"]["time"] == "09:00"
    assert near["overtimeNotReached"]["duration"] == "1 h 50 m"
    assert near["overtimeNotReached"]["minimum"] == "2 h"


def test_explain_this_day_for_a_temporary_worker_and_an_empty_day(world: dict) -> None:
    work_a_day(world, "T-1", FRIDAY, (9, 0), (17, 0))
    keys = [item["key"] for item in explanation_of(world, "T-1", FRIDAY)]
    assert "payable" in keys and "workedForStatus" not in keys

    sunday = explanation_of(world, "P-1", SATURDAY)
    assert [item["key"] for item in sunday] in (["noPunch"], ["weeklyOff"])


def test_the_year_heatmap_has_twelve_months_with_codes(world: dict) -> None:
    """AC-46 (F-60): 12 months, one square per day with its register code."""
    work_a_day(world, "P-1", FRIDAY, (9, 0), (17, 0))
    url = f"/api/v1/attendance/employee/{world['people']['P-1']}/year"

    body = world["boss"].get(url).json()
    months = [item["month"] for item in body["months"]]
    assert len(months) == 12 and months[0] == "2025-12" and months[-1] == "2026-11"
    october = next(item for item in body["months"] if item["month"] == "2026-10")
    friday = next(day for day in october["days"] if day["date"] == FRIDAY.isoformat())
    assert friday["code"] == "P" and friday["is_corrected"] is False

    earlier = world["boss"].get(url, params={"to_month": "2026-03"}).json()
    assert earlier["months"][-1]["month"] == "2026-03"
    assert world["boss"].get(url, params={"to_month": "2026-13"}).status_code == 422


def test_the_year_heatmap_follows_the_plant_scope(world: dict) -> None:
    url = f"/api/v1/attendance/employee/{world['people']['P-1']}/year"
    assert world["head"].get(url).status_code == 200
    assert world["other_head"].get(url).status_code in (403, 404)
