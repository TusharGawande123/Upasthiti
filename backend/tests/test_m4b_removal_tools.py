"""The two removal tools also remove the phone punching rows (M4b) and the M5 rows (attendance
days, corrections, alerts) of the people they remove, and nothing of anybody else (plan
cross-cutting 9, decision 0036 line 24). Real PostgreSQL, fake data."""

import hashlib
import uuid
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.attendance.models import AttendanceDay
from app.modules.notifications.models import Notification
from app.modules.phone.models import (
    PhoneAccess,
    PhoneAccount,
    PhoneNoticeAcceptance,
    PhonePasskey,
    PhoneProof,
    PhoneSession,
)
from app.modules.punches.models import Punch, PunchChallenge
from app.modules.regularisations.models import Regularisation, RegularisationDecision
from app.modules.users.models import Role, User
from app.scripts import remove_demo_plant, remove_test_employees
from app.scripts.remove_demo_plant import RemovalRefusedError
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body
from tests.phone_helpers import make_phone_punch, make_phone_session

pytestmark = pytest.mark.time_sensitive

PHONE_MODELS = (
    PhoneAccess,
    PhoneAccount,
    PhoneSession,
    PhoneNoticeAcceptance,
    PhonePasskey,
    PhoneProof,
)
DAY = date(2026, 10, 28)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def count(session: Session, model: type, *where: ColumnElement[bool]) -> int:
    return session.scalar(select(func.count()).select_from(model).where(*where)) or 0


def sha() -> str:
    return hashlib.sha256(uuid.uuid4().bytes).hexdigest()


def add_person(boss: TestClient, plant: PlantIds, code: str) -> uuid.UUID:
    response = boss.post("/api/v1/employees", json=permanent_body(plant, code=code))
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def give_phone_and_m5_rows(session: Session, employee_id: uuid.UUID, plant_id: uuid.UUID) -> Punch:
    """Everything phone punching and M5 keep about one person; returns their phone punch."""
    now = utc_now()
    boss_id = session.scalars(select(User.id).where(User.username == "boss")).one()
    session.add(
        PhoneAccess(employee_id=employee_id, phone_punch_enabled=True, phone_changed_at=now)
    )
    session.add(
        PhoneAccount(employee_id=employee_id, password_hash="$argon2id$x", password_set_at=now)
    )
    phone_session = make_phone_session(session, employee_id, now)
    session.add(
        PhoneNoticeAcceptance(
            employee_id=employee_id,
            version="2026-11",
            language="en",
            text_sha256=sha(),
            accepted_at=now,
            session_id=phone_session.id,
        )
    )
    session.add(
        PhonePasskey(
            employee_id=employee_id,
            credential_id=uuid.uuid4().bytes,
            public_key=b"cose",
            user_handle=uuid.uuid4().bytes * 2,
            label="Chrome on Android",
            created_at=now,
        )
    )
    session.add(
        PhoneProof(
            kind="card",
            employee_id=employee_id,
            issued_at=now,
            expires_at=now + timedelta(minutes=5),
            result="passed",
        )
    )
    session.add(
        PunchChallenge(
            phone_session_id=phone_session.id,
            nonce_sha256=sha(),
            challenge="turn_left",
            issued_at=now,
            expires_at=now + timedelta(minutes=1),
        )
    )
    phone_punch = make_phone_punch(session, phone_session, plant_id)
    session.add(
        AttendanceDay(
            employee_id=employee_id,
            attendance_date=DAY,
            plant_id=plant_id,
            employee_type="permanent",
            day_kind="working",
            status="absent",
        )
    )
    correction = Regularisation(
        employee_id=employee_id,
        attendance_date=DAY,
        kind="set_status",
        status_value="present",
        reason="Was on site",
        requested_by=boss_id,
        requested_at=now,
        is_direct=True,
    )
    session.add(correction)
    session.flush()
    session.add(
        RegularisationDecision(
            regularisation_id=correction.id, action="approved", decided_by=boss_id, decided_at=now
        )
    )
    session.flush()
    return phone_punch


def rows_of(session: Session, employee_id: uuid.UUID) -> dict[str, int]:
    found = {
        model.__tablename__: count(session, model, model.employee_id == employee_id)
        for model in PHONE_MODELS
    }
    found["punches"] = count(session, Punch, Punch.employee_id == employee_id)
    found["attendance_days"] = count(
        session, AttendanceDay, AttendanceDay.employee_id == employee_id
    )
    found["regularisations"] = count(
        session, Regularisation, Regularisation.employee_id == employee_id
    )
    return found


def assert_protection_is_on(session: Session) -> None:
    for table in ("punches", "phone_notice_acceptances", "regularisations"):
        with pytest.raises(DBAPIError, match="append-only"), session.begin_nested():
            session.execute(text(f"DELETE FROM {table}"))  # noqa: S608 (fixed names)


def test_test_employee_tool_removes_their_phone_and_m5_rows_only(
    boss: TestClient, db_session: Session
) -> None:
    plant = create_plant(boss, db_session, "K134")
    plant_id = uuid.UUID(plant.id)
    test_person = add_person(boss, plant, "101")
    real_person = add_person(boss, plant, "REAL-1")
    give_phone_and_m5_rows(db_session, test_person, plant_id)
    give_phone_and_m5_rows(db_session, real_person, plant_id)
    db_session.commit()

    plan = remove_test_employees.build_plan(db_session, "K134", ["101"], [])
    assert plan.counts["phone sign-ins"] == 1 and plan.counts["punches"] == 1
    remove_test_employees.remove(db_session, plan)
    db_session.commit()

    assert set(rows_of(db_session, test_person).values()) == {0}
    assert set(rows_of(db_session, real_person).values()) == {1}
    assert count(db_session, RegularisationDecision) == 1
    assert count(db_session, PunchChallenge) == 1
    assert_protection_is_on(db_session)


def test_demo_tool_removes_phone_rows_m5_rows_and_alerts_of_the_demo_plant(
    boss: TestClient, db_session: Session
) -> None:
    demo = create_plant(boss, db_session, "DEMO4")
    real = create_plant(boss, db_session, "K134")
    demo_person = add_person(boss, demo, "D-1")
    real_person = add_person(boss, real, "REAL-1")
    give_phone_and_m5_rows(db_session, demo_person, uuid.UUID(demo.id))
    give_phone_and_m5_rows(db_session, real_person, uuid.UUID(real.id))
    for plant in (demo, real):
        db_session.add(
            Notification(
                kind="still_inside",
                severity="warning",
                plant_id=uuid.UUID(plant.id),
                text_key="notification.still_inside",
                params={"count": 1},
                subject_ids=[],
                link="/admin/dashboard",
                dedupe_key=f"still_inside:{plant.id}",
                created_at=utc_now(),
            )
        )
    db_session.commit()

    plan = remove_demo_plant.build_plan(db_session, "DEMO4", include_test_cards=False)
    assert plan.counts["phone sign-ins"] == 1
    remove_demo_plant.remove(db_session, plan)
    db_session.commit()

    assert set(rows_of(db_session, demo_person).values()) == {0}
    assert set(rows_of(db_session, real_person).values()) == {1}
    assert [n.plant_id for n in db_session.scalars(select(Notification))] == [uuid.UUID(real.id)]
    assert_protection_is_on(db_session)


def test_demo_tool_refuses_when_a_real_phone_punch_was_matched_at_the_demo_fence(
    boss: TestClient, db_session: Session
) -> None:
    demo = create_plant(boss, db_session, "DEMO5")
    real = create_plant(boss, db_session, "K134")
    real_person = add_person(boss, real, "REAL-1")
    phone_session = make_phone_session(db_session, real_person)
    # On outside work, standing inside the demo plant's fence (M4b spec section 7 rule 12).
    make_phone_punch(
        db_session, phone_session, uuid.UUID(real.id), location_plant_id=uuid.UUID(demo.id)
    )
    db_session.commit()

    with pytest.raises(RemovalRefusedError, match="inside this demo"):
        remove_demo_plant.build_plan(db_session, "DEMO5", include_test_cards=False)
