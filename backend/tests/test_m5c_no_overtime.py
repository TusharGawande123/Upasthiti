# ruff: noqa: F811  (fixtures come from the existing attendance and import tests)
"""No overtime for permanent employees (M5c, spec §7.3 rules 24 to 28; AC-26 to AC-32).

Real PostgreSQL. A permanent employee has no overtime rate and no overtime minutes; a temporary
worker keeps both; a conversion clears the rate.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.approvals import service as approvals
from app.modules.employees import operations
from app.modules.employees.models import Employee, EmployeeType
from app.modules.users.models import Role
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body, temporary_body
from tests.test_import_and_contractors_api import good_row, upload
from tests.test_m5_attendance_api import FRIDAY, work_a_day, world  # noqa: F401

EMPLOYEES = "/api/v1/employees"


@pytest.fixture
def boss(db_app, db_session: Session) -> TestClient:  # noqa: ANN001
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def test_a_permanent_employee_cannot_have_an_overtime_rate(
    boss: TestClient, k134: PlantIds
) -> None:
    """AC-26."""
    answer = boss.post(EMPLOYEES, json=permanent_body(k134) | {"ot_rate_per_hour": "150.00"})

    assert answer.status_code == 422
    error = answer.json()["error"]
    assert error["code"] == "NOT_FOR_PERMANENT"
    assert error["details"]["field"] == "ot_rate_per_hour"


def test_an_edit_cannot_give_a_permanent_employee_a_rate_but_a_temporary_worker_keeps_hers(
    boss: TestClient, k134: PlantIds
) -> None:
    permanent = boss.post(EMPLOYEES, json=permanent_body(k134)).json()
    temporary = boss.post(
        EMPLOYEES, json=temporary_body(k134) | {"ot_rate_per_hour": "120.00"}
    ).json()

    refused = boss.patch(f"{EMPLOYEES}/{permanent['id']}", json={"ot_rate_per_hour": "99.00"})
    changed = boss.patch(f"{EMPLOYEES}/{temporary['id']}", json={"ot_rate_per_hour": "130.00"})

    assert refused.json()["error"]["code"] == "NOT_FOR_PERMANENT"
    assert changed.status_code == 200 and changed.json()["ot_rate_per_hour"] == "130.00"
    assert permanent["ot_rate_per_hour"] is None


def test_a_conversion_clears_the_overtime_rate_and_the_history_keeps_it(
    boss: TestClient, k134: PlantIds
) -> None:
    body = temporary_body(k134) | {"ot_rate_per_hour": "120.00", "joined_on": "2026-10-01"}
    worker = boss.post(EMPLOYEES, json=body).json()

    converted = boss.post(
        f"{EMPLOYEES}/{worker['id']}/convert-to-permanent",
        json={"effective_from": today_ist().isoformat(), "reason": "Permanent offer"},
    )

    assert converted.status_code == 200, converted.text
    assert converted.json()["ot_rate_per_hour"] is None
    assert converted.json()["type"] == "permanent"


def test_an_import_row_with_an_overtime_rate_on_a_permanent_employee_is_an_error(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    """AC-32: the row is reported, nothing is saved."""
    permanent = good_row("2001", "Ravi Patil")
    permanent[10] = "150.00"  # the overtime rate column
    temporary = good_row("2002", "Asha Rao", kind="temporary")
    temporary[10] = "120.00"

    checked = upload(boss, [permanent, temporary], dry_run=True).json()
    saved = upload(boss, [permanent, temporary], dry_run=False)

    assert checked["error_rows"] == 1
    assert [(e["row"], e["column"], e["code"]) for e in checked["errors"]] == [
        (2, "ot_rate_per_hour", "NOT_FOR_PERMANENT")
    ]
    assert saved.status_code == 422  # all or nothing
    assert db_session.scalars(select(Employee)).all() == []


def test_a_pending_request_made_with_a_rate_before_the_change_is_still_applied(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    """Rule 28: the old rate is dropped when the request is read, so it does not fail for that."""
    payload = {
        "values": {
            "employee_code": "OLD-1",
            "full_name": "Old Request",
            "type": "permanent",
            "plant_id": k134.id,
            "category_id": k134.staff_id,
            "department_id": None,
            "shift_id": k134.shift_id,
            "contractor_id": None,
            "punch_method": "face",
            "hourly_rate": None,
            "ot_rate_per_hour": "150.00",
            "joined_on": "2026-10-01",
        }
    }
    actor = operations.AuditContext(_actor_of(db_session, boss))

    approvals.apply_payload(db_session, actor, "employee.create", payload)

    created = db_session.scalars(select(Employee).where(Employee.employee_code == "OLD-1")).one()
    assert created.type == EmployeeType.PERMANENT.value and created.ot_rate_per_hour is None


def _actor_of(session: Session, client: TestClient):  # noqa: ANN202
    from app.modules.audit.service import Actor
    from app.modules.users.models import User

    user = session.scalars(select(User).where(User.username == "boss")).one()
    return Actor(actor_type="user", actor_id=user.id)


def test_the_day_sentences_of_a_permanent_employee_say_nothing_about_overtime(world: dict) -> None:
    """AC-27: a permanent day (late stay) has overtime 0 and no overtime sentence; the same stay by
    a temporary worker still counts and is explained."""
    work_a_day(world, "P-1", FRIDAY, (9, 0), (20, 0))
    work_a_day(world, "T-1", FRIDAY, (9, 0), (20, 0))

    def day(code: str) -> dict:
        employee_id: uuid.UUID = world["people"][code]
        return world["boss"].get(f"/api/v1/attendance/employee/{employee_id}/day/{FRIDAY}").json()

    permanent, temporary = day("P-1"), day("T-1")

    assert permanent["day"]["overtime_min"] == 0
    assert permanent["day"]["payable_min"] == 480  # ends at the shift end
    assert not [s for s in permanent["explanation"] if "vertime" in s["key"]]
    assert temporary["day"]["overtime_min"] > 0
    assert [s for s in temporary["explanation"] if "vertime" in s["key"]]
