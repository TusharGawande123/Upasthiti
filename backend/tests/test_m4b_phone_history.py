"""What an employee sees of their own attendance on the phone (M4b spec §5.1, F-73; AC-51) and the
punches of today. Real PostgreSQL. The clock is pinned to Monday 02/11/2026 IST."""

import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.kiosks.models import KioskDevice
from app.modules.phone.models import PhoneSession
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.face_helpers import new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import PHONE, People, make_people, signed_in_phone, switch_phone
from tests.phone_helpers import make_phone_punch

MONDAY = date(2026, 11, 2)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def demo1(boss: TestClient, db_session: Session) -> PlantIds:
    plant = create_plant(boss, db_session, "DEMO1")
    boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-01"})
    return plant


@pytest.fixture
def people(boss: TestClient, db_session: Session, demo1: PlantIds) -> People:
    found = make_people(boss, db_session, demo1)
    switch_phone(boss, found.face_id)
    return found


@pytest.fixture
def phone(db_app: FastAPI, db_session: Session, people: People) -> TestClient:
    return signed_in_phone(db_app, db_session, people.face_id, "F-201")


def session_of(session: Session, employee_id: str) -> PhoneSession:
    return session.scalars(
        select(PhoneSession).where(PhoneSession.employee_id == uuid.UUID(employee_id))
    ).one()


def gate_punch(
    session: Session, kiosk: KioskDevice, employee_id: str, moment: datetime, direction: str
) -> None:
    session.add(
        Punch(
            client_punch_id=uuid.uuid4(),
            channel="kiosk",
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=uuid.UUID(employee_id),
            method="face",
            direction=direction,
            decision="accepted",
            reason_codes=[],
            server_received_at=moment,
        )
    )
    session.flush()


def test_ac_51_the_last_31_days_with_status_times_worked_time_and_channels(
    db_session: Session, demo1: PlantIds, people: People, phone: TestClient
) -> None:
    kiosk = make_active_kiosk(db_session, demo1, Device())
    phone_session = session_of(db_session, people.face_id)
    plant_id = uuid.UUID(demo1.id)
    monday_12 = date(2026, 10, 12)
    make_phone_punch(db_session, phone_session, plant_id, ist(monday_12, 7, 0), direction="in")
    make_phone_punch(
        db_session,
        phone_session,
        plant_id,
        ist(monday_12, 16, 0),
        direction="out",
        reason_codes=["OUTSIDE_PLANT"],
        decision="flagged",
        location_plant_id=None,
    )
    gate_punch(db_session, kiosk, people.face_id, ist(date(2026, 10, 13), 7, 0), "in")
    gate_punch(db_session, kiosk, people.face_id, ist(date(2026, 10, 13), 16, 30), "out")
    db_session.commit()

    with frozen_at(ist(MONDAY, 12, 0)):
        answer = phone.get(f"{PHONE}/attendance")

    assert answer.status_code == 200, answer.text
    days = answer.json()["days"]
    assert days[0]["date"] == "2026-10-03" and days[-1]["date"] == "2026-11-02"
    assert len(days) == 31
    by_date = {day["date"]: day for day in days}
    phone_day, gate_day = by_date["2026-10-12"], by_date["2026-10-13"]
    assert phone_day["channels"] == ["phone"] and gate_day["channels"] == ["kiosk"]
    assert phone_day["first_in"] is not None and phone_day["last_out"] is not None
    assert phone_day["worked_min"] == 540 and gate_day["worked_min"] == 570
    assert phone_day["status"] != "not_employed"
    # No flag, reason or review mark is ever shown to the employee.
    for day in days:
        assert set(day) == {"date", "status", "first_in", "last_out", "worked_min", "channels"}
    assert "OUTSIDE_PLANT" not in answer.text


def test_ac_51_only_the_signed_in_employees_own_days_and_no_id_parameter(
    boss: TestClient,
    db_session: Session,
    demo1: PlantIds,
    people: People,
    phone: TestClient,
) -> None:
    other_id = new_employee(boss, demo1, code="F-202")
    kiosk = make_active_kiosk(db_session, demo1, Device())
    gate_punch(db_session, kiosk, other_id, ist(date(2026, 10, 14), 7, 0), "in")
    gate_punch(db_session, kiosk, other_id, ist(date(2026, 10, 14), 16, 0), "out")
    db_session.commit()

    with frozen_at(ist(MONDAY, 12, 0)):
        mine = phone.get(f"{PHONE}/attendance", params={"employee_id": other_id}).json()

    day = {item["date"]: item for item in mine["days"]}["2026-10-14"]
    assert day["first_in"] is None and day["worked_min"] == 0


def test_attendance_and_todays_punches_need_a_phone_sign_in(db_app: FastAPI) -> None:
    nobody = TestClient(db_app, base_url="https://testserver")

    assert nobody.get(f"{PHONE}/attendance").status_code == 401
    assert nobody.get(f"{PHONE}/punches/today").status_code == 401


def test_todays_punches_of_the_gate_and_the_phone_in_order(
    db_session: Session, demo1: PlantIds, people: People, phone: TestClient
) -> None:
    kiosk = make_active_kiosk(db_session, demo1, Device())
    phone_session = session_of(db_session, people.face_id)
    yesterday = MONDAY - timedelta(days=1)
    gate_punch(db_session, kiosk, people.face_id, ist(yesterday, 7, 0), "in")  # not today
    gate_punch(db_session, kiosk, people.face_id, ist(MONDAY, 6, 58), "in")
    make_phone_punch(
        db_session,
        phone_session,
        uuid.UUID(demo1.id),
        ist(MONDAY, 19, 5),
        direction="out",
        reason_codes=["OUTSIDE_PLANT"],
        decision="flagged",
        location_plant_id=None,
    )
    db_session.commit()

    with frozen_at(ist(MONDAY, 19, 10)):
        answer = phone.get(f"{PHONE}/punches/today")

    items = answer.json()["items"]
    assert [(item["direction"], item["channel"]) for item in items] == [
        ("in", "kiosk"),
        ("out", "phone"),
    ]
    assert items[0]["decision_text_key"] == "phone.punch.accepted.in"
    assert set(items[0]) == {"time", "direction", "channel", "decision_text_key"}
    assert "OUTSIDE_PLANT" not in answer.text  # no flags, no reasons
