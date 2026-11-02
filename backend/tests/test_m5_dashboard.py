"""The live dashboard, the muster and the punctuality analytics (M5 spec §5.4, §7 rules 17, 21;
AC-27, AC-28, AC-30, AC-31). Real PostgreSQL, fake data, the clock pinned to Fri 30/10/2026."""

import io
import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pypdfium2 as pdfium
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import PlantWeeklyOff
from app.modules.punches.models import Punch
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.factories import log_in
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

FRIDAY = date(2026, 10, 30)
NOW = ist(FRIDAY, 10, 0)


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


def make_plant(boss: TestClient, session: Session, code: str) -> PlantIds:
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
    other = make_plant(boss, db_session, "K200")
    demo = make_plant(boss, db_session, "DEMO1")
    shift = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
    ).json()
    contractor = Contractor(name="Shree Staffing")
    db_session.add(contractor)
    db_session.flush()
    people: dict[str, uuid.UUID] = {}
    specs = (
        ("P-1", "permanent"),
        ("P-2", "permanent"),
        ("P-3", "permanent"),
        ("P-4", "permanent"),
        ("T-1", "temporary"),
        ("T-2", "temporary"),
    )
    for code, kind in specs:
        body = permanent_body(plant, code=code, name=f"Person {code}") | {
            "shift_id": shift["id"],
            "joined_on": "2026-10-26",
        }
        if kind == "temporary":
            body |= {"type": "temporary", "hourly_rate": "85.00", "category_id": plant.helper_id}
        people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
    for code in ("T-1",):
        employee = db_session.get(Employee, people[code])
        assert employee is not None
        employee.contractor_id = contractor.id
    boss.post(
        "/api/v1/employees", json=permanent_body(demo, code="D-1") | {"joined_on": "2026-10-26"}
    )
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    user = db_session.scalars(select(User).where(User.username == "head")).one()
    set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "corporate": client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp"),
        "plant": plant,
        "other": other,
        "people": people,
        "kiosk": make_active_kiosk(db_session, plant, Device()),
        "session": db_session,
    }


def punch(world: dict, code: str, moment: datetime, direction: str) -> None:
    kiosk: KioskDevice = world["kiosk"]
    world["session"].add(
        Punch(
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
    )
    world["session"].commit()


def live(world: dict, who: str = "boss", **params: object) -> dict:
    response = world[who].get("/api/v1/dashboard/live", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def plant_numbers(body: dict, code: str) -> dict:
    return next(item for item in body["plants"] if item["plant"]["code"] == code)


def test_the_numbers_of_a_morning(world: dict) -> None:
    """AC-27: 6 expected; P-1 on time, P-2 late, T-1 and T-2 in, P-3 and P-4 not here yet."""
    punch(world, "P-1", ist(FRIDAY, 8, 55), "in")
    punch(world, "P-2", ist(FRIDAY, 9, 40), "in")
    punch(world, "T-1", ist(FRIDAY, 8, 30), "in")
    punch(world, "T-2", ist(FRIDAY, 9, 0), "in")
    punch(world, "T-2", ist(FRIDAY, 9, 45), "out")

    body = live(world, plant_id=world["plant"].id)

    numbers = plant_numbers(body, "K134")
    assert numbers["attendance_started"] is True
    assert (numbers["expected"], numbers["arrived"], numbers["late"]) == (6, 4, 1)
    assert numbers["not_arrived"] == 2  # P-3 and P-4: the shift started 09:00, grace to 09:30
    assert numbers["inside_now"] == 3 and numbers["inside_temporary"] == 1  # T-2 has left
    assert numbers["on_leave"] == 0 and numbers["off_today"] == 0
    assert [(line["expected"], line["arrived"], line["late"]) for line in numbers["shifts"]] == [
        (6, 4, 1)
    ]
    assert numbers["by_contractor"] == [
        {
            "contractor": {
                "id": numbers["by_contractor"][0]["contractor"]["id"],
                "name": "Shree Staffing",
            },
            "inside": 1,
        }
    ]
    assert body["totals"]["inside_now"] == 3


def test_a_person_without_a_contractor_is_listed_last(world: dict) -> None:
    punch(world, "T-1", ist(FRIDAY, 8, 30), "in")
    punch(world, "T-2", ist(FRIDAY, 8, 31), "in")

    contractors = plant_numbers(live(world), "K134")["by_contractor"]

    assert [item["contractor"] and item["contractor"]["name"] for item in contractors] == [
        "Shree Staffing",
        None,
    ]


def test_a_shift_that_has_not_started_is_not_counted_as_not_arrived(
    world: dict, db_session: Session
) -> None:
    with frozen_at(ist(FRIDAY, 8, 0)):
        numbers = plant_numbers(live(world), "K134")

    assert numbers["expected"] == 6 and numbers["not_arrived"] == 0


def test_leave_and_weekly_off_are_not_expected(world: dict) -> None:
    world["boss"].post(
        "/api/v1/leave",
        json={
            "employee_id": str(world["people"]["P-3"]),
            "from_date": "2026-10-30",
            "to_date": "2026-10-30",
            "is_paid": True,
            "reason": "Family function",
        },
    )

    numbers = plant_numbers(live(world), "K134")
    with frozen_at(ist(date(2026, 11, 1), 10, 0)):  # Sunday: the weekly off
        log_in(world["boss"], "boss")  # the Friday session has been idle for two days
        sunday = plant_numbers(live(world), "K134")

    assert (numbers["expected"], numbers["on_leave"]) == (5, 1)
    assert (sunday["expected"], sunday["off_today"]) == (0, 6)


def test_exceptions_and_the_days_to_decide(world: dict) -> None:
    """AC-6d / rule 17: yesterday's incomplete day and an undecided Short-hours day show up."""
    yesterday = date(2026, 10, 29)
    punch(world, "P-1", ist(yesterday, 9, 0), "in")  # no OUT: Incomplete
    punch(world, "P-2", ist(yesterday, 9, 0), "in")
    punch(world, "P-2", ist(yesterday, 12, 50), "out")  # Short hours

    numbers = plant_numbers(live(world), "K134")

    assert numbers["undecided"] == {"short_hours": 1, "incomplete": 1}
    assert numbers["exceptions"] == 2  # yesterday's incomplete + the Short-hours day


def test_attendance_not_started_and_demo_plants_hidden(world: dict) -> None:
    fresh = create_plant(world["boss"], world["session"], "K300")

    body = live(world)
    codes = {item["plant"]["code"] for item in body["plants"]}
    with_demo = live(world, include_demo="true")
    corporate = live(world, "corporate", include_demo="true")

    assert codes == {"K134", "K200", "K300"} and "DEMO1" not in codes  # AC-31
    assert plant_numbers(body, "K300")["attendance_started"] is False
    assert fresh.code == "K300"
    assert "DEMO1" in {item["plant"]["code"] for item in with_demo["plants"]}
    assert "DEMO1" not in {item["plant"]["code"] for item in corporate["plants"]}


def test_a_plant_head_sees_only_the_own_plant(world: dict) -> None:
    body = live(world, "head")

    assert [item["plant"]["code"] for item in body["plants"]] == ["K134"]
    other = world["head"].get("/api/v1/dashboard/live", params={"plant_id": world["other"].id})
    assert other.status_code == 200 and other.json()["plants"] == []


def test_the_muster_lists_who_is_inside_by_department_then_name(world: dict) -> None:
    punch(world, "P-2", ist(FRIDAY, 8, 50), "in")
    punch(world, "P-1", ist(FRIDAY, 8, 55), "in")
    punch(world, "P-3", ist(FRIDAY, 8, 40), "in")
    punch(world, "P-3", ist(FRIDAY, 9, 20), "out")  # left: not on the list

    body = world["boss"].get("/api/v1/muster", params={"plant_id": world["plant"].id}).json()

    (section,) = body["plants"]
    assert section["count"] == 2
    assert [person["employee"]["code"] for person in section["people"]] == ["P-1", "P-2"]
    first = section["people"][0]
    assert first["employee"]["name"] == "Person P-1" and first["kiosk"]["name"] == "Main gate"
    assert first["in_time"].startswith("2026-10-30T03:25")  # 08:55 IST


def test_the_muster_pdf_downloads_with_a_name_free_audit_row(world: dict) -> None:
    punch(world, "P-1", ist(FRIDAY, 8, 55), "in")

    response = world["boss"].get("/api/v1/muster.pdf", params={"plant_id": world["plant"].id})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert (
        'filename="upasthiti-muster-K134-20261030-1000.pdf"'
        in response.headers["content-disposition"]
    )
    page = pdfium.PdfDocument(io.BytesIO(response.content)).get_page(0)
    text = page.get_textpage().get_text_range()
    assert "Emergency muster" in text and "Person P-1" in text and "1 people inside" in text
    audit = (
        world["session"].scalars(select(AuditLog).where(AuditLog.action == "muster.download")).one()
    )
    assert audit.after == {"plant_code": "K134", "count": 1}  # counts only


def test_punctuality_numbers_groups_and_top_late(world: dict) -> None:
    thursday, friday = date(2026, 10, 29), FRIDAY
    for day in (thursday, friday):
        punch(world, "P-1", ist(day, 9, 0), "in")  # on time both days
        punch(world, "P-2", ist(day, 9, 45), "in")  # late 45 both days
        punch(world, "P-3", ist(day, 8, 50), "in")
    punch(world, "P-3", ist(friday, 16, 0), "out")  # an early exit on Friday
    params = {
        "date_from": "2026-10-29",
        "date_to": "2026-10-30",
        "plant_id": world["plant"].id,
    }

    body = world["boss"].get("/api/v1/insights/punctuality", params=params).json()

    assert body["arrivals"] == 6 and body["late_count"] == 2
    assert body["on_time_percent"] == pytest.approx(66.7)
    assert body["average_late_min"] == 45.0 and body["early_exit_count"] == 1
    assert [week["week_start"] for week in body["weekly"]] == ["2026-10-26"]
    assert body["top_late"][0]["employee"]["code"] == "P-2"
    assert (body["top_late"][0]["late_count"], body["top_late"][0]["late_min"]) == (2, 90)
    by_weekday = (
        world["boss"]
        .get("/api/v1/insights/punctuality", params=params | {"group_by": "weekday"})
        .json()
    )
    assert sorted(group["key"] for group in by_weekday["groups"]) == ["4", "5"]
    too_long = world["boss"].get(
        "/api/v1/insights/punctuality", params={"date_from": "2026-01-01", "date_to": "2026-10-30"}
    )
    assert too_long.json()["error"]["code"] == "REPORT_RANGE_TOO_LONG"
