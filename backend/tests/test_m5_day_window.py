"""The day window and the day facts behind the calculation and the gate rule (M5 spec §7 rules 3–5;
AC-3, AC-10, AC-11). Real PostgreSQL, fake data, the clock pinned to Wed 28/10/2026 12:00 IST."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.time import IST
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.factories import log_in, make_user
from tests.people_helpers import PlantIds, create_plant, permanent_body


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(PINNED_DAY, 12, 0)):
        yield


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


@pytest.fixture
def plant(boss: TestClient, db_session: Session) -> PlantIds:
    plant = create_plant(boss, db_session, "DEMO1")
    started = boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-01"})
    assert started.status_code == 200, started.text
    return plant


def add_shift(boss: TestClient, plant: PlantIds, name: str, start: str, end: str) -> str:
    response = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": name, "start_time": start, "end_time": end},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_employee(boss: TestClient, plant: PlantIds, shift_id: str, code: str) -> uuid.UUID:
    body = permanent_body(plant, code=code) | {"shift_id": shift_id}
    response = boss.post("/api/v1/employees", json=body)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def calendar_for(session: Session, employee_id: uuid.UUID) -> AttendanceCalendar:
    return AttendanceCalendar.load(
        session, [employee_id], date(2026, 10, 1), date(2026, 11, 30), window_before_hours=4
    )


def at(day: int, hour: int, minute: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=IST)


def test_office_and_night_windows_and_their_edges(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-3: Office 29/10 04:59 belongs to 28/10, 05:00 to 29/10; Night 30/10 14:59 belongs to 29/10
    and 15:00 to 30/10."""
    office = add_employee(boss, plant, add_shift(boss, plant, "Office", "09:00", "17:00"), "O-1")
    night = add_employee(boss, plant, add_shift(boss, plant, "Night", "19:00", "07:00"), "N-1")
    office_days = calendar_for(db_session, office)
    night_days = calendar_for(db_session, night)

    def day_of(calendar: AttendanceCalendar, employee: uuid.UUID, moment: datetime) -> date:
        found = calendar.day_containing(employee, moment)
        assert found is not None
        return found.day

    assert day_of(office_days, office, at(29, 4, 59)) == date(2026, 10, 28)
    assert day_of(office_days, office, at(29, 5, 0)) == date(2026, 10, 29)
    assert day_of(night_days, night, at(30, 14, 59)) == date(2026, 10, 29)
    assert day_of(night_days, night, at(30, 15, 0)) == date(2026, 10, 30)
    window = night_days.window(night, date(2026, 10, 29))
    assert window is not None
    assert (window.start, window.end) == (at(29, 15), at(30, 15))
    assert window.short is False


def test_weekly_off_holidays_per_plant_and_employment(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-10, AC-11: Sunday off; an all-plant holiday; a holiday of another plant is a working day
    here; days before the attendance start date or before joining are not employed."""
    other = create_plant(boss, db_session, "DEMO2")
    employee = add_employee(boss, plant, plant.shift_id, "E-1")
    boss.post(
        "/api/v1/holidays", json={"date": "2026-11-10", "name": "Foundation", "all_plants": True}
    )
    boss.post(
        "/api/v1/holidays",
        json={"date": "2026-11-12", "name": "Fair", "all_plants": False, "plant_ids": [other.id]},
    )
    calendar = calendar_for(db_session, employee)
    plant_id = uuid.UUID(plant.id)

    assert calendar.day_kind(plant_id, date(2026, 11, 1))[0] == "weekly_off"
    kind, holiday = calendar.day_kind(plant_id, date(2026, 11, 10))
    assert kind == "holiday" and holiday is not None and holiday.name == "Foundation"
    assert calendar.day_kind(plant_id, date(2026, 11, 12))[0] == "working"
    assert calendar.day_kind(plant_id, date(2026, 10, 30))[0] == "working"
    assert calendar.employed_on(employee, date(2026, 10, 1)) is True
    assert calendar.employed_on(employee, date(2026, 9, 30)) is False  # before the start date


def test_a_plant_without_an_attendance_start_date_has_no_days(
    boss: TestClient, db_session: Session
) -> None:
    not_started = create_plant(boss, db_session, "DEMO3")
    employee = add_employee(boss, not_started, not_started.shift_id, "E-2")

    assert calendar_for(db_session, employee).employed_on(employee, date(2026, 10, 28)) is False


def test_a_later_shift_change_gives_a_short_day_when_the_new_window_starts_early(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """Rule 5: the old day ends where the new day starts; ending less than 1 h after the shift end
    gives SHIFT_CHANGE_SHORT_DAY. Night (ends 07:00) followed by an 08:00 shift: the new window
    starts 04:00, before the night shift even ends."""
    night_id = add_shift(boss, plant, "Night", "19:00", "07:00")
    early_id = add_shift(boss, plant, "Early", "08:00", "16:00")
    employee = add_employee(boss, plant, night_id, "N-2")
    moved = boss.patch(
        f"/api/v1/employees/{employee}",
        json={"shift_id": early_id, "shift_from": "2026-10-31", "reason": "New roster"},
    )
    assert moved.status_code == 200, moved.text
    calendar = calendar_for(db_session, employee)
    last_night = calendar.window(employee, date(2026, 10, 30))

    assert last_night is not None
    assert last_night.end == at(31, 4)
    assert last_night.short is True
