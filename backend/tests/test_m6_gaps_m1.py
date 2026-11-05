"""M6 gap tests for M1: the audit viewer filters (AC-25) and the bulk shift change audit (AC-33)."""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.audit.service import Actor, record_audit
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

pytestmark = pytest.mark.time_sensitive

AUDIT = "/api/v1/audit"
EMPLOYEES = "/api/v1/employees"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def add_entry(
    session: Session, hour: int, entity_type: str, after: dict, day: date = PINNED_DAY
) -> None:
    with frozen_at(ist(day, hour)):
        record_audit(
            session,
            actor=Actor("system", None),
            action=f"{entity_type}.update",
            entity_type=entity_type,
            before={"name": "Old", "note": "same"},
            after={**after, "note": "same"},
        )
    session.commit()


def test_audit_filter_by_entity_and_dates_is_newest_first(
    boss: TestClient, db_session: Session
) -> None:
    """M1 AC-25: entity filter plus from/to dates; newest first; only changed fields."""
    add_entry(db_session, 8, "employee", {"name": "Eight"})
    add_entry(db_session, 11, "employee", {"name": "Eleven"})
    add_entry(db_session, 14, "employee", {"name": "Fourteen"})
    add_entry(db_session, 11, "plant", {"name": "Not an employee"})

    page = boss.get(
        AUDIT,
        params={
            "entity_type": "employee",
            "from": ist(PINNED_DAY, 9).isoformat(),
            "to": ist(PINNED_DAY, 15).isoformat(),
        },
    ).json()

    assert [entry["after"]["name"] for entry in page["items"]] == ["Fourteen", "Eleven"]
    assert page["total"] == 2
    # The before/after hold only the changed field, not the unchanged "note".
    assert page["items"][0]["before"] == {"name": "Old"}
    assert page["items"][0]["after"] == {"name": "Fourteen"}


def test_bulk_shift_change_writes_one_audit_row_per_person_with_one_request_id(
    boss: TestClient, db_session: Session
) -> None:
    """M1 AC-33: 40 people, one confirmation: 40 audit rows sharing one request id."""
    plant: PlantIds = create_plant(boss, db_session, "K134")
    night = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
    ).json()
    ids = []
    for number in range(40):
        body = permanent_body(plant, code=str(5000 + number), name=f"Person {number}")
        response = boss.post(EMPLOYEES, json=body)
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])

    response = boss.post(
        f"{EMPLOYEES}/bulk",
        json={
            "action": "change_shift",
            "employee_ids": ids,
            "params": {"shift_id": night["id"]},
            "reason": "New roster",
        },
    )

    assert response.json() == {"updated": 40}
    rows = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.entity_type == "employee", AuditLog.reason == "New roster")
        .order_by(AuditLog.entity_id)
    ).all()
    assert len(rows) == 40
    assert {str(row.entity_id) for row in rows} == set(ids)
    request_ids = {row.request_id for row in rows}
    assert len(request_ids) == 1 and None not in request_ids
