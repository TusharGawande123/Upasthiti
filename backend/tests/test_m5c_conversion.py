"""Temporary to permanent conversion (M5c spec §5.3, §7.2; AC-13 to AC-25; plan slice C).

Real PostgreSQL, the clock pinned to Wed 28/10/2026 12:00 IST.
"""

import uuid
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.employees.operations import apply_due_conversions
from app.modules.employees.type_history import employee_type_on
from app.modules.notifications.models import Notification
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body

pytestmark = pytest.mark.time_sensitive

EMPLOYEES = "/api/v1/employees"
REQUESTS = "/api/v1/change-requests"
TODAY = "2026-10-28"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(PINNED_DAY, 12, 0)):
        yield


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def corporate(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")


@pytest.fixture
def plant_head(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.PLANT_HEAD, "k134.head")


@pytest.fixture
def plant(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def new_worker(boss: TestClient, plant: PlantIds, code: str = "T-2041") -> dict:
    body = temporary_body(plant, code=code) | {"joined_on": "2026-10-01"}
    response = boss.post(EMPLOYEES, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def convert(client: TestClient, employee_id: str, effective_from: str = TODAY):  # noqa: ANN201
    return client.post(
        f"{EMPLOYEES}/{employee_id}/convert-to-permanent",
        json={"effective_from": effective_from, "reason": "Permanent offer"},
    )


def error_code(response) -> str:  # noqa: ANN001
    return response.json()["error"]["code"]


def audit_actions(session: Session, employee_id: str) -> list[str]:
    session.expire_all()
    return list(
        session.scalars(
            select(AuditLog.action).where(AuditLog.entity_id == uuid.UUID(employee_id))
        ).all()
    )


def test_super_admin_converts_at_once_and_everything_follows(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-13: type, contractor, rates, method, card, history, audit and the urgent notice."""
    worker = new_worker(boss, plant)
    card = boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={})
    assert card.status_code == 201, card.text

    response = convert(boss, worker["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["employee_code"], body["full_name"]) == (
        worker["id"],
        worker["employee_code"],
        worker["full_name"],
    )
    assert body["type"] == "permanent"
    assert body["contractor_id"] is None
    assert body["hourly_rate"] is None
    assert body["punch_method"] == "face"
    assert body["face_enrolment_pending"] is True
    detail = boss.get(f"{EMPLOYEES}/{worker['id']}").json()
    assert [(row["type"], row["to_date"]) for row in detail["type_history"]] == [
        ("temporary", "2026-10-27"),
        ("permanent", None),
    ]
    assert detail["converted_on"] == TODAY
    assert detail["conversion_scheduled_for"] is None
    db_session.expire_all()
    revoked = db_session.scalars(select(QrCredential)).one()
    assert revoked.revoke_kind == "converted"  # the record stays
    assert "employee.convert" in audit_actions(db_session, worker["id"])
    notice = db_session.scalars(select(Notification)).one()
    assert (notice.kind, notice.severity) == ("conversion_face_pending", "urgent")
    assert "Sunil" not in str(notice.params)  # no names in a notification


def test_old_days_keep_the_type_they_had(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-19, AC-20: a conversion dated 15/10 leaves days before it temporary."""
    worker = new_worker(boss, plant)

    assert convert(boss, worker["id"], "2026-10-15").status_code == 200

    employee = db_session.get(Employee, uuid.UUID(worker["id"]))
    assert employee is not None
    assert employee_type_on(db_session, employee, date(2026, 10, 14)) == "temporary"
    assert employee_type_on(db_session, employee, date(2026, 10, 15)) == "permanent"


def test_corporate_head_asks_and_the_super_admin_decides(
    boss: TestClient, corporate: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-14: 202, nothing changes, an inbox item, then approve applies everything."""
    worker = new_worker(boss, plant)

    asked = convert(corporate, worker["id"])

    assert asked.status_code == 202, asked.text
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "temporary"
    assert db_session.scalars(select(Notification)).all() == []  # a trial sends nothing
    request_id = asked.json()["change_request_id"]
    pending = boss.get(f"{REQUESTS}?status=pending").json()["items"]
    assert [item["kind"] for item in pending] == ["employee.convert"]

    approved = boss.post(f"{REQUESTS}/{request_id}/approve", json={})

    assert approved.json()["status"] == "approved"
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "permanent"
    assert len(db_session.scalars(select(Notification)).all()) == 1


def test_a_rejected_request_changes_nothing(
    boss: TestClient, corporate: TestClient, plant: PlantIds
) -> None:
    worker = new_worker(boss, plant)
    request_id = convert(corporate, worker["id"]).json()["change_request_id"]

    rejected = boss.post(f"{REQUESTS}/{request_id}/reject", json={"reason": "Not yet"})

    assert rejected.status_code == 200, rejected.text
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "temporary"


def test_plant_head_cannot_convert(
    boss: TestClient, plant_head: TestClient, plant: PlantIds
) -> None:
    """AC-15."""
    worker = new_worker(boss, plant)

    response = convert(plant_head, worker["id"])

    assert response.status_code == 403
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "temporary"


def test_the_refusals_each_have_their_code(
    boss: TestClient, corporate: TestClient, plant: PlantIds
) -> None:
    """AC-16 and the date rule of rule 14."""
    first = new_worker(boss, plant, "T-1")
    assert convert(boss, first["id"]).status_code == 200
    assert error_code(convert(boss, first["id"])) == "EMPLOYEE_ALREADY_PERMANENT"

    second = new_worker(boss, plant, "T-2")
    assert convert(boss, second["id"], "2026-11-07").status_code == 200  # scheduled
    scheduled_again = convert(boss, second["id"], "2026-11-09")
    assert (scheduled_again.status_code, error_code(scheduled_again)) == (
        409,
        "CONVERSION_ALREADY_SCHEDULED",
    )

    third = new_worker(boss, plant, "T-3")
    assert convert(corporate, third["id"]).status_code == 202
    waiting = convert(boss, third["id"])
    assert (waiting.status_code, error_code(waiting)) == (409, "CHANGE_ALREADY_PENDING")

    fourth = new_worker(boss, plant, "T-4")
    for bad_date in ("2026-09-30", "2026-12-28"):  # before 1 Sep + before joining / 61 days ahead
        wrong = convert(boss, fourth["id"], bad_date)
        assert (wrong.status_code, error_code(wrong)) == (422, "CONVERSION_DATE_INVALID")
    before_joining = convert(boss, fourth["id"], "2026-09-30")
    assert error_code(before_joining) == "CONVERSION_DATE_INVALID"

    fifth = new_worker(boss, plant, "T-5")
    left = boss.post(
        f"{EMPLOYEES}/{fifth['id']}/mark-left", json={"left_on": TODAY, "reason": "Contract over"}
    )
    assert left.status_code == 200, left.text
    assert error_code(convert(boss, fifth["id"])) == "EMPLOYEE_LEFT"


def test_a_planned_conversion_waits_for_its_day_and_the_job_applies_it_once(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-17: temporary until the day; the daily job run twice changes nothing more."""
    worker = new_worker(boss, plant)
    boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={})

    planned = convert(boss, worker["id"], "2026-11-07")

    assert planned.status_code == 200, planned.text
    assert planned.json()["type"] == "temporary"
    detail = boss.get(f"{EMPLOYEES}/{worker['id']}").json()
    assert detail["conversion_scheduled_for"] == "2026-11-07"
    assert db_session.scalars(select(QrCredential)).one().revoked_at is None
    assert "employee.convert_scheduled" in audit_actions(db_session, worker["id"])

    assert apply_due_conversions(db_session, date(2026, 11, 6)) == 0
    assert apply_due_conversions(db_session, date(2026, 11, 7)) == 1
    db_session.commit()
    assert apply_due_conversions(db_session, date(2026, 11, 7)) == 0

    db_session.expire_all()
    employee = db_session.get(Employee, uuid.UUID(worker["id"]))
    assert employee is not None
    assert (employee.type, employee.punch_method, employee.contractor_id) == (
        "permanent",
        "face",
        None,
    )
    assert db_session.scalars(select(QrCredential)).one().revoke_kind == "converted"
    assert audit_actions(db_session, worker["id"]).count("employee.convert") == 1
    assert len(db_session.scalars(select(Notification)).all()) == 1


def test_a_planned_conversion_can_be_cancelled_before_its_day(
    boss: TestClient, corporate: TestClient, plant: PlantIds, db_session: Session
) -> None:
    """AC-18; and only the Super Admin cancels."""
    worker = new_worker(boss, plant)
    assert convert(boss, worker["id"], "2026-11-07").status_code == 200
    url = f"{EMPLOYEES}/{worker['id']}/convert-to-permanent"

    denied = corporate.request("DELETE", url, json={"reason": "Changed my mind"})
    cancelled = boss.request("DELETE", url, json={"reason": "Changed my mind"})
    again = boss.request("DELETE", url, json={"reason": "Changed my mind"})

    assert denied.status_code == 403
    assert cancelled.status_code == 200, cancelled.text
    assert (again.status_code, error_code(again)) == (409, "CONVERSION_NOT_SCHEDULED")
    assert apply_due_conversions(db_session, date(2026, 11, 7)) == 0
    detail = boss.get(f"{EMPLOYEES}/{worker['id']}").json()
    assert detail["employee"]["type"] == "temporary"
    assert detail["conversion_scheduled_for"] is None
    assert "employee.convert_cancelled" in audit_actions(db_session, worker["id"])
    # The temporary period is open again, so a new conversion can be planned.
    assert convert(boss, worker["id"], "2026-11-09").status_code == 200


def test_a_person_who_left_before_the_day_is_not_converted(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    worker = new_worker(boss, plant)
    assert convert(boss, worker["id"], "2026-11-07").status_code == 200
    left = boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left", json={"left_on": TODAY, "reason": "Contract over"}
    )
    assert left.status_code == 200, left.text

    assert apply_due_conversions(db_session, date(2026, 11, 7)) == 0

    db_session.expire_all()
    employee = db_session.get(Employee, uuid.UUID(worker["id"]))
    assert employee is not None and employee.type == "temporary"
    assert "employee.convert_cancelled" in audit_actions(db_session, worker["id"])


def test_the_type_changes_only_through_a_conversion(boss: TestClient, plant: PlantIds) -> None:
    worker = new_worker(boss, plant)

    edit = boss.patch(
        f"{EMPLOYEES}/{worker['id']}",
        json={"type": "permanent", "hourly_rate": None, "punch_method": "face"},
    )

    assert edit.status_code == 422
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "temporary"


def test_the_converted_filter_and_the_phone_and_plant_stay_the_same(
    boss: TestClient, plant: PlantIds
) -> None:
    """AC-22 (list), AC-23: plant, shift, category and department do not change."""
    converted = new_worker(boss, plant, "T-1")
    other = new_worker(boss, plant, "T-2")
    assert convert(boss, converted["id"]).status_code == 200

    listed = boss.get(f"{EMPLOYEES}?converted=true").json()["items"]

    assert [item["id"] for item in listed] == [converted["id"]]
    assert other["id"] not in [item["id"] for item in listed]
    after = listed[0]
    for field in ("plant_id", "shift_id", "category_id", "department_id", "joined_on"):
        assert after[field] == converted[field]


# --- F-88: the preview before Convert ----------------------------------------------------------


def preview(client: TestClient, employee_id: str, effective_from: str = TODAY):  # noqa: ANN201
    return client.get(
        f"{EMPLOYEES}/{employee_id}/convert-preview", params={"effective_from": effective_from}
    )


def test_the_preview_says_what_will_change_and_changes_nothing(
    boss: TestClient, plant: PlantIds
) -> None:
    worker = new_worker(boss, plant)
    card = boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={}).json()["card"]

    answer = preview(boss, worker["id"], "2026-10-20")

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["card_serial"] == card["serial"]
    assert body["clears_hourly_rate"] is True and body["planned"] is False
    assert body["days_recomputed"] == 28  # 01/10 to 28/10: from the 1st of the month of the date
    assert boss.get(f"{EMPLOYEES}/{worker['id']}").json()["employee"]["type"] == "temporary"


def test_the_preview_of_a_planned_day_recomputes_nothing_yet(
    boss: TestClient, plant: PlantIds
) -> None:
    worker = new_worker(boss, plant)

    body = preview(boss, worker["id"], "2026-11-07").json()

    assert body["planned"] is True and body["days_recomputed"] == 0


def test_the_preview_refuses_for_the_same_reasons_as_the_conversion(
    boss: TestClient, corporate: TestClient, plant_head: TestClient, plant: PlantIds
) -> None:
    done = new_worker(boss, plant, "T-1")
    assert convert(boss, done["id"]).status_code == 200
    other = new_worker(boss, plant, "T-2")

    already = preview(boss, done["id"])
    bad_day = preview(boss, other["id"], "2026-09-01")
    for_head = preview(corporate, other["id"])  # a Corporate Head may look too
    forbidden = preview(plant_head, other["id"])

    assert error_code(already) == "EMPLOYEE_ALREADY_PERMANENT"
    assert error_code(bad_day) == "CONVERSION_DATE_INVALID"
    assert for_head.status_code == 200
    assert forbidden.status_code == 403
