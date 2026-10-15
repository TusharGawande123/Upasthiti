"""The approvals inbox: a Corporate Head's changes wait for a Super Admin (decision 0005,
spec AC-9, AC-10, AC-33, AC-41)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.users.models import Role
from tests.people_helpers import PlantIds, client_for, create_plant, iso, permanent_body

EMPLOYEES = "/api/v1/employees"
REQUESTS = "/api/v1/change-requests"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def corporate(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def employee_count(session: Session) -> int:
    return len(session.scalars(select(Employee)).all())


def test_corporate_head_create_waits_for_approval(
    boss: TestClient, corporate: TestClient, k134: PlantIds, db_session: Session
) -> None:
    response = corporate.post(EMPLOYEES, json=permanent_body(k134))

    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    assert employee_count(db_session) == 0
    assert boss.get(f"{REQUESTS}/pending-count").json() == {"count": 1}

    request_id = response.json()["change_request_id"]
    approved = boss.post(f"{REQUESTS}/{request_id}/approve", json={})

    assert approved.json()["status"] == "approved"
    assert employee_count(db_session) == 1
    create_entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "employee.create")
    ).one()
    assert str(create_entry.change_request_id) == request_id
    assert boss.get(f"{REQUESTS}/pending-count").json() == {"count": 0}


def test_rejection_needs_a_reason_and_creates_nothing(
    boss: TestClient, corporate: TestClient, k134: PlantIds, db_session: Session
) -> None:
    request_id = corporate.post(EMPLOYEES, json=permanent_body(k134)).json()["change_request_id"]

    no_reason = boss.post(f"{REQUESTS}/{request_id}/reject", json={"reason": ""})
    rejected = boss.post(f"{REQUESTS}/{request_id}/reject", json={"reason": "Wrong plant"})

    assert no_reason.status_code == 422
    assert rejected.json()["status"] == "rejected"
    mine = corporate.get(REQUESTS).json()["items"][0]
    assert mine["decision_reason"] == "Wrong plant"
    assert employee_count(db_session) == 0


def test_invalid_change_is_refused_when_sent(corporate: TestClient, k134: PlantIds) -> None:
    response = corporate.post(EMPLOYEES, json=permanent_body(k134) | {"type": "temporary"})

    assert response.json()["error"]["code"] == "HOURLY_RATE_REQUIRED"
    assert corporate.get(REQUESTS).json()["total"] == 0


def test_data_changed_before_approval_makes_the_request_fail(
    boss: TestClient, corporate: TestClient, k134: PlantIds
) -> None:
    night = boss.post(
        f"/api/v1/plants/{k134.id}/shifts",
        json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
    ).json()
    employee = boss.post(EMPLOYEES, json=permanent_body(k134)).json()
    request_id = corporate.patch(
        f"{EMPLOYEES}/{employee['id']}", json={"shift_id": night["id"]}
    ).json()["change_request_id"]
    boss.post(f"/api/v1/shifts/{night['id']}/deactivate", json={"reason": "Night shift stopped"})

    response = boss.post(f"{REQUESTS}/{request_id}/approve", json={})

    assert response.json()["error"]["code"] == "REQUEST_CHECK_FAILED"
    assert boss.get(f"{REQUESTS}/{request_id}").json()["status"] == "failed"
    assert boss.get(f"{EMPLOYEES}/{employee['id']}").json()["employee"]["shift_name"] == "General"


def test_only_one_pending_change_per_employee(
    boss: TestClient, corporate: TestClient, k134: PlantIds
) -> None:
    employee = boss.post(EMPLOYEES, json=permanent_body(k134)).json()
    corporate.patch(f"{EMPLOYEES}/{employee['id']}", json={"full_name": "Ravi S. Patil"})

    second = corporate.patch(f"{EMPLOYEES}/{employee['id']}", json={"full_name": "R. Patil"})

    assert second.json()["error"]["code"] == "CHANGE_ALREADY_PENDING"


def test_a_code_waiting_for_approval_cannot_be_used_again(
    boss: TestClient, corporate: TestClient, k134: PlantIds
) -> None:
    corporate.post(EMPLOYEES, json=permanent_body(k134, code="1043"))

    direct = boss.post(EMPLOYEES, json=permanent_body(k134, code="1043", name="Other"))

    assert direct.json()["error"]["code"] == "EMPLOYEE_CODE_PENDING"


def test_withdraw_only_own_pending_request(
    corporate: TestClient, k134: PlantIds, db_app: FastAPI, db_session: Session
) -> None:
    request_id = corporate.post(EMPLOYEES, json=permanent_body(k134)).json()["change_request_id"]
    other = client_for(db_app, db_session, Role.CORPORATE_HEAD, "other.head")

    assert other.get(f"{REQUESTS}/{request_id}").status_code == 404
    assert other.post(f"{REQUESTS}/{request_id}/withdraw").status_code == 404
    assert corporate.post(f"{REQUESTS}/{request_id}/withdraw").json()["status"] == "withdrawn"
    assert corporate.post(f"{REQUESTS}/{request_id}/withdraw").json()["error"]["code"] == (
        "REQUEST_NOT_PENDING"
    )


def test_corporate_head_cannot_decide_or_mark_left(
    boss: TestClient, corporate: TestClient, k134: PlantIds
) -> None:
    employee = boss.post(EMPLOYEES, json=permanent_body(k134)).json()
    request_id = corporate.patch(f"{EMPLOYEES}/{employee['id']}", json={"full_name": "New"}).json()[
        "change_request_id"
    ]

    assert corporate.post(f"{REQUESTS}/{request_id}/approve", json={}).json()["error"]["code"] == (
        "FORBIDDEN"
    )
    left = corporate.post(
        f"{EMPLOYEES}/{employee['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Resigned"},
    )
    assert left.json()["error"]["code"] == "FORBIDDEN"
    bulk_left = corporate.post(
        f"{EMPLOYEES}/bulk",
        json={"action": "mark_left", "employee_ids": [employee["id"]], "reason": "Resigned"},
    )
    assert bulk_left.json()["error"]["code"] == "FORBIDDEN"


def test_corporate_head_bulk_and_transfer_become_requests(
    boss: TestClient, corporate: TestClient, k134: PlantIds, db_session: Session
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    first = boss.post(EMPLOYEES, json=permanent_body(k134, code="1001")).json()
    second = boss.post(EMPLOYEES, json=permanent_body(k134, code="1002")).json()

    bulk = corporate.post(
        f"{EMPLOYEES}/bulk",
        json={
            "action": "change_category",
            "employee_ids": [first["id"], second["id"]],
            "params": {"category_id": k134.helper_id},
            "reason": "They are helpers",
        },
    )
    transfer = corporate.post(
        f"{EMPLOYEES}/{first['id']}/transfer",
        json={
            "to_plant_id": tp1.id,
            "category_id": tp1.staff_id,
            "shift_id": tp1.shift_id,
            "effective_from": iso(today_ist()),
            "reason": "Needed at TP1",
        },
    )

    assert transfer.status_code == 202, transfer.text
    assert bulk.status_code == 202
    boss.post(f"{REQUESTS}/{bulk.json()['change_request_id']}/approve", json={})
    assert boss.get(f"{EMPLOYEES}/{second['id']}").json()["employee"]["category_name"] == "Helper"
    # The first employee has the transfer pending, so the bulk could still change them.
    boss.post(f"{REQUESTS}/{transfer.json()['change_request_id']}/approve", json={})
    assert boss.get(f"{EMPLOYEES}/{first['id']}").json()["employee"]["plant_code"] == "TP1"


def test_plant_head_has_no_approvals_inbox(
    db_app: FastAPI, db_session: Session, k134: PlantIds
) -> None:
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "plant.head")

    assert head.get(REQUESTS).json()["error"]["code"] == "FORBIDDEN"
