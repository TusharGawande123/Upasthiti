"""The type history of an employee (M5c spec §6, rule 19; plan slice A).

Real PostgreSQL, the clock pinned to Wed 28/10/2026 12:00 IST. A change of type must never change
the type of a day before it: the calendar, a stored day and the reports ask the history.
"""

import uuid
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.employees.models import Employee, EmployeeTypeHistory
from app.modules.employees.type_history import employee_type_on, open_type_row
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.factories import log_in, make_user
from tests.people_helpers import PlantIds, create_plant, temporary_body

EMPLOYEES = "/api/v1/employees"


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
    return create_plant(boss, db_session, "DEMO1")


def new_temporary(boss: TestClient, plant: PlantIds, joined_on: str = "2026-10-01") -> uuid.UUID:
    body = temporary_body(plant) | {"joined_on": joined_on}
    response = boss.post(EMPLOYEES, json=body)
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def convert(boss: TestClient, employee_id: uuid.UUID, effective_from: str):  # noqa: ANN201
    return boss.post(
        f"{EMPLOYEES}/{employee_id}/convert-to-permanent",
        json={"effective_from": effective_from, "reason": "Permanent offer"},
    )


def history_of(session: Session, employee_id: uuid.UUID) -> list[EmployeeTypeHistory]:
    session.expire_all()
    return list(
        session.scalars(
            select(EmployeeTypeHistory)
            .where(EmployeeTypeHistory.employee_id == employee_id)
            .order_by(EmployeeTypeHistory.from_date)
        )
    )


def test_a_new_employee_starts_one_open_row_on_the_joining_date(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    employee_id = new_temporary(boss, plant)

    rows = history_of(db_session, employee_id)

    assert len(rows) == 1
    assert (rows[0].type, rows[0].from_date, rows[0].to_date) == (
        "temporary",
        date(2026, 10, 1),
        None,
    )
    assert rows[0].hourly_rate is not None


def test_a_change_of_type_closes_the_old_row_and_old_days_keep_their_type(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    employee_id = new_temporary(boss, plant)

    edit = convert(boss, employee_id, "2026-10-28")
    assert edit.status_code == 200, edit.text

    rows = history_of(db_session, employee_id)
    assert [(row.type, row.from_date, row.to_date) for row in rows] == [
        ("temporary", date(2026, 10, 1), date(2026, 10, 27)),
        ("permanent", date(2026, 10, 28), None),
    ]
    # The old row keeps what applied in its period.
    assert rows[0].hourly_rate is not None
    assert rows[1].hourly_rate is None
    employee = db_session.get(Employee, employee_id)
    assert employee is not None
    assert employee_type_on(db_session, employee, date(2026, 10, 15)) == "temporary"
    assert employee_type_on(db_session, employee, date(2026, 10, 28)) == "permanent"


def test_the_calendar_answers_a_type_per_day(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    employee_id = new_temporary(boss, plant)
    assert convert(boss, employee_id, "2026-10-28").status_code == 200

    calendar = AttendanceCalendar.load(
        db_session, [employee_id], date(2026, 10, 1), date(2026, 10, 31), window_before_hours=4
    )

    assert calendar.type_on(employee_id, date(2026, 10, 27)) == "temporary"
    assert calendar.type_on(employee_id, date(2026, 10, 28)) == "permanent"


def test_a_person_without_history_uses_the_type_of_today(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    employee_id = new_temporary(boss, plant)
    for row in history_of(db_session, employee_id):
        db_session.delete(row)
    db_session.flush()

    calendar = AttendanceCalendar.load(
        db_session, [employee_id], date(2026, 10, 1), date(2026, 10, 31), window_before_hours=4
    )

    assert calendar.type_on(employee_id, date(2026, 10, 10)) == "temporary"


def test_a_contractor_or_rate_edit_keeps_one_open_row(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    employee_id = new_temporary(boss, plant)

    edit = boss.patch(f"{EMPLOYEES}/{employee_id}", json={"hourly_rate": "99.00"})
    assert edit.status_code == 200, edit.text

    rows = history_of(db_session, employee_id)
    assert len(rows) == 1
    open_row = open_type_row(db_session, employee_id)
    assert open_row is not None
    assert str(open_row.hourly_rate) == "99.00"


def test_the_migration_backfill_gives_every_employee_one_open_row(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """Every employee has exactly one open row (the unique index also guarantees at most one)."""
    for number in range(3):
        body = temporary_body(plant, code=f"T-30{number}") | {"joined_on": "2026-10-01"}
        assert boss.post(EMPLOYEES, json=body).status_code == 201

    without_open_row = db_session.scalars(
        select(Employee.id).where(
            ~select(EmployeeTypeHistory.id)
            .where(
                EmployeeTypeHistory.employee_id == Employee.id,
                EmployeeTypeHistory.to_date.is_(None),
            )
            .exists()
        )
    ).all()
    assert without_open_row == []
