"""Employees: rules, edits with shift history, transfer, leaving, bulk, timeline, search and
plant scope (spec AC-18 to AC-21, AC-23, AC-33, AC-40, AC-41)."""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.employees.models import Employee
from app.modules.employees.operations import apply_due_transfers
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import (
    PlantIds,
    client_for,
    create_plant,
    iso,
    permanent_body,
    temporary_body,
)

EMPLOYEES = "/api/v1/employees"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def create(client: TestClient, body: dict) -> dict:
    response = client.post(EMPLOYEES, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_super_admin_creates_a_permanent_employee(boss: TestClient, k134: PlantIds) -> None:
    employee = create(boss, permanent_body(k134, code="ss-0217"))

    assert employee["employee_code"] == "SS-0217"
    assert employee["punch_method"] == "face"
    assert employee["shift_name"] == "General"
    assert employee["category_name"] == "Staff"
    assert employee["ot_rate_per_hour"] == "150.00"


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"employee_code": "12 34"}, "EMPLOYEE_CODE_INVALID"),
        ({"employee_code": "ABCDEFGHIJKLM"}, "VALIDATION_FAILED"),  # 13 characters
        ({"type": "temporary"}, "HOURLY_RATE_REQUIRED"),
        ({"hourly_rate": "90.00"}, "NOT_FOR_PERMANENT"),
    ],
)
def test_employee_rules(boss: TestClient, k134: PlantIds, changes: dict, code: str) -> None:
    response = boss.post(EMPLOYEES, json=permanent_body(k134) | changes)

    assert response.json()["error"]["code"] == code


def test_codes_are_unique_and_never_reused(boss: TestClient, k134: PlantIds) -> None:
    employee = create(boss, permanent_body(k134, code="1043"))
    boss.post(
        f"{EMPLOYEES}/{employee['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Resigned"},
    )

    again = boss.post(EMPLOYEES, json=permanent_body(k134, code="1043", name="Someone Else"))

    assert again.json()["error"]["code"] == "EMPLOYEE_CODE_EXISTS"


def test_category_of_another_plant_is_refused(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")

    response = boss.post(EMPLOYEES, json=permanent_body(k134) | {"category_id": tp1.staff_id})

    assert response.json()["error"]["code"] == "CATEGORY_NOT_IN_PLANT"


def test_temporary_worker_with_rate_and_contractor(boss: TestClient, k134: PlantIds) -> None:
    contractor = boss.post("/api/v1/contractors", json={"name": "Shree Manpower"}).json()

    worker = create(boss, temporary_body(k134) | {"contractor_id": contractor["id"]})

    assert worker["punch_method"] == "qr"
    assert worker["hourly_rate"] == "85.00"
    assert worker["contractor_name"] == "Shree Manpower"
    contractors = boss.get("/api/v1/contractors").json()
    assert contractors[0]["active_workers"] == 1


def test_overtime_rate_is_an_exact_decimal(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    employee = create(boss, permanent_body(k134) | {"ot_rate_per_hour": "150.10"})

    stored = db_session.get(Employee, employee["id"])
    assert stored is not None and stored.ot_rate_per_hour == Decimal("150.10")


def test_shift_change_keeps_history(boss: TestClient, k134: PlantIds) -> None:
    night = boss.post(
        f"/api/v1/plants/{k134.id}/shifts",
        json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
    ).json()
    employee = create(boss, permanent_body(k134))

    response = boss.patch(f"{EMPLOYEES}/{employee['id']}", json={"shift_id": night["id"]})
    detail = boss.get(f"{EMPLOYEES}/{employee['id']}").json()

    assert response.json()["shift_name"] == "Night"
    history = detail["shift_history"]
    assert [row["shift_name"] for row in history] == ["Night", "General"]
    assert history[0]["from_date"] == iso(today_ist())
    assert history[1]["to_date"] == iso(today_ist() - timedelta(days=1))


def test_shift_in_use_cannot_be_switched_off(boss: TestClient, k134: PlantIds) -> None:
    create(boss, permanent_body(k134))

    response = boss.post(
        f"/api/v1/shifts/{k134.shift_id}/deactivate", json={"reason": "Not needed"}
    )

    assert response.json()["error"]["code"] == "SHIFT_IN_USE"


def test_mark_left_keeps_the_record(boss: TestClient, k134: PlantIds) -> None:
    employee = create(boss, permanent_body(k134))

    response = boss.post(
        f"{EMPLOYEES}/{employee['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Resigned"},
    )
    left = boss.get(EMPLOYEES, params={"status": "left"}).json()

    assert response.json()["status"] == "left"
    assert left["total"] == 1
    edit = boss.patch(f"{EMPLOYEES}/{employee['id']}", json={"full_name": "New name"})
    assert edit.json()["error"]["code"] == "EMPLOYEE_LEFT"

    back = boss.post(
        f"{EMPLOYEES}/{employee['id']}/reactivate",
        json={"joined_on": iso(today_ist()), "reason": "Rejoined"},
    )
    assert back.json()["status"] == "active"


def test_transfer_today_and_in_the_future(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    employee = create(boss, permanent_body(k134))
    later = today_ist() + timedelta(days=10)

    response = boss.post(
        f"{EMPLOYEES}/{employee['id']}/transfer",
        json={
            "to_plant_id": tp1.id,
            "category_id": tp1.staff_id,
            "shift_id": tp1.shift_id,
            "effective_from": iso(later),
            "reason": "Needed at TP1",
        },
    )

    # Until the date, the employee stays at K134; the history already shows both rows.
    assert response.json()["plant_code"] == "K134"
    history = boss.get(f"{EMPLOYEES}/{employee['id']}").json()["plant_history"]
    assert [(row["plant_code"], row["from_date"]) for row in history] == [
        ("TP1", iso(later)),
        ("K134", "2026-01-15"),
    ]
    assert history[1]["to_date"] == iso(later - timedelta(days=1))

    # On the day, the daily job moves the employee.
    assert apply_due_transfers(db_session, later) == 1
    db_session.commit()
    assert boss.get(f"{EMPLOYEES}/{employee['id']}").json()["employee"]["plant_code"] == "TP1"


def test_transfer_needs_a_valid_date_and_another_plant(boss: TestClient, k134: PlantIds) -> None:
    employee = create(boss, permanent_body(k134))
    body = {
        "to_plant_id": k134.id,
        "category_id": k134.staff_id,
        "shift_id": k134.shift_id,
        "effective_from": iso(today_ist()),
        "reason": "Same plant",
    }

    assert boss.post(f"{EMPLOYEES}/{employee['id']}/transfer", json=body).json()["error"][
        "code"
    ] == ("TRANSFER_SAME_PLANT")


def test_bulk_change_is_all_or_nothing(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    night = boss.post(
        f"/api/v1/plants/{k134.id}/shifts",
        json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
    ).json()
    first = create(boss, permanent_body(k134, code="1001", name="One"))
    second = create(boss, permanent_body(k134, code="1002", name="Two"))
    tp1 = create_plant(boss, db_session, "TP1")
    other = create(boss, permanent_body(tp1, code="2001", name="Other plant"))

    ok = boss.post(
        f"{EMPLOYEES}/bulk",
        json={
            "action": "change_shift",
            "employee_ids": [first["id"], second["id"]],
            "params": {"shift_id": night["id"]},
            "reason": "New roster",
        },
    )
    mixed = boss.post(
        f"{EMPLOYEES}/bulk",
        json={
            "action": "change_shift",
            "employee_ids": [first["id"], other["id"]],
            "params": {"shift_id": k134.shift_id},
            "reason": "Back to general",
        },
    )

    assert ok.json() == {"updated": 2}
    assert mixed.json()["error"]["code"] == "SHIFT_NOT_IN_PLANT"
    # The failed bulk changed nobody: the first employee is still on Night.
    assert boss.get(f"{EMPLOYEES}/{first['id']}").json()["employee"]["shift_name"] == "Night"


def test_timeline_lists_what_happened(boss: TestClient, k134: PlantIds) -> None:
    employee = create(boss, permanent_body(k134))
    boss.patch(
        f"{EMPLOYEES}/{employee['id']}", json={"full_name": "Ravi S. Patil", "reason": "Spelling"}
    )

    events = boss.get(f"{EMPLOYEES}/{employee['id']}/timeline").json()

    assert [event["action"] for event in events] == ["employee.update", "employee.create"]
    assert events[0]["changed_fields"] == ["full_name"]
    assert events[0]["actor_name"] == "Test super_admin"
    assert events[0]["reason"] == "Spelling"


def test_search_by_code_or_name(boss: TestClient, k134: PlantIds) -> None:
    create(boss, permanent_body(k134, code="1043", name="Ravi Patil"))
    create(boss, permanent_body(k134, code="2077", name="Asha Rao"))

    by_code = boss.get("/api/v1/search", params={"q": "10"}).json()
    by_name = boss.get("/api/v1/search", params={"q": "asha"}).json()
    plants = boss.get("/api/v1/search", params={"q": "k1"}).json()

    assert [item["employee_code"] for item in by_code["employees"]] == ["1043"]
    assert [item["full_name"] for item in by_name["employees"]] == ["Asha Rao"]
    assert plants["plants"][0]["code"] == "K134"


def test_plant_head_reads_own_plant_only_and_changes_nothing(
    boss: TestClient, k134: PlantIds, db_app: FastAPI, db_session: Session
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    mine = create(boss, permanent_body(k134, code="1001"))
    other = create(boss, permanent_body(tp1, code="2001"))
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "k134.head")
    user = db_session.scalars(select(User).where(User.username == "k134.head")).one()
    set_user_plant(db_session, user, uuid.UUID(k134.id))
    db_session.commit()

    listed = head.get(EMPLOYEES).json()
    assert [item["employee_code"] for item in listed["items"]] == ["1001"]
    assert head.get(f"{EMPLOYEES}/{other['id']}").status_code == 404
    assert head.get("/api/v1/search", params={"q": "20"}).json()["employees"] == []
    for response in (
        head.post(EMPLOYEES, json=permanent_body(k134, code="1002")),
        head.patch(f"{EMPLOYEES}/{mine['id']}", json={"full_name": "X"}),
        head.post(
            f"{EMPLOYEES}/{mine['id']}/mark-left",
            json={"left_on": iso(today_ist()), "reason": "x y z"},
        ),
    ):
        assert response.json()["error"]["code"] == "FORBIDDEN"


def test_readiness_counts_active_employees(boss: TestClient, k134: PlantIds) -> None:
    create(boss, permanent_body(k134))

    assert boss.get(f"/api/v1/plants/{k134.id}/readiness").json()["active_employees"] == 1


def test_bulk_change_with_a_missing_value_is_a_clear_422(boss: TestClient, k134: PlantIds) -> None:
    person = create(boss, permanent_body(k134, code="1001", name="One"))

    response = boss.post(
        f"{EMPLOYEES}/bulk",
        json={
            "action": "change_shift",
            "employee_ids": [person["id"]],
            "params": {},  # no shift_id
            "reason": "Forgot the shift",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
