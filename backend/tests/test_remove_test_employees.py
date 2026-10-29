"""The tool that removes a few named TEST employees and devices of one real plant (decision 0032):
it deletes only what is named, keeps the plant and everyone else, refuses typos and other people's
punches, never touches the audit log and leaves the "never change a punch" protection switched on.
Real PostgreSQL, fake data."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role
from app.scripts.remove_demo_plant import RemovalRefusedError, delete_photo_files
from app.scripts.remove_test_employees import MAX_EMPLOYEES, build_plan, remove
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, send, snapshot_folder  # noqa: F401  (a fixture)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def count(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def punch_at(client: TestClient, device: Device, worker: Worker) -> None:
    answer = send(client, device, worker.qr_text)
    assert answer.json()["decision"] == "accepted", answer.text


def make_gate(session: Session, plant: PlantIds, name: str) -> Device:
    device = Device()
    make_active_kiosk(session, plant, device, name=name)
    return device


def test_it_removes_only_the_named_people_and_devices(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    real = create_plant(boss, db_session, "K134")
    test_gate = make_gate(db_session, real, "plant1")
    real_gate = make_gate(db_session, real, "Main gate")
    punch_at(boss, test_gate, Worker(boss, real, "101"))
    punch_at(boss, real_gate, Worker(boss, real, "REAL-1"))
    audit_before = count(db_session, AuditLog)
    assert len(list(snapshot_folder.rglob("*.*"))) == 2

    plan = build_plan(db_session, "k134", ["101"], ["PLANT1"])
    assert plan.counts["employees"] == 1 and plan.counts["punches"] == 1
    assert plan.counts["photos"] == 1 and plan.counts["attendance devices"] == 1
    remove(db_session, plan)
    db_session.commit()

    # The plant, the other person, the other device and the other punch are all still there.
    assert [p.code for p in db_session.scalars(select(Plant))] == ["K134"]
    assert [e.employee_code for e in db_session.scalars(select(Employee))] == ["REAL-1"]
    assert [k.name for k in db_session.scalars(select(KioskDevice))] == ["Main gate"]
    assert count(db_session, Punch) == 1 and count(db_session, PunchSnapshot) == 1
    assert count(db_session, QrCredential) == 1
    # Nothing left the audit log; one line was added that says what happened (counts only).
    assert count(db_session, AuditLog) == audit_before + 1
    last = db_session.scalars(select(AuditLog).order_by(AuditLog.at.desc())).first()
    assert last is not None and last.action == "test_data.removed"
    assert (last.after or {})["employees"] == 1

    failed = delete_photo_files(boss_storage(), plan.photo_keys)
    assert failed == [] and len(list(snapshot_folder.rglob("*.*"))) == 1


def boss_storage():
    from app.core.storage import get_storage

    return get_storage()


def test_the_punch_protection_is_on_again_afterwards(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    real = create_plant(boss, db_session, "K134")
    punch_at(boss, make_gate(db_session, real, "plant1"), Worker(boss, real, "101"))
    punch_at(boss, make_gate(db_session, real, "Main gate"), Worker(boss, real, "REAL-1"))
    remove(db_session, build_plan(db_session, "K134", ["101"], ["plant1"]))
    db_session.commit()

    with pytest.raises(DBAPIError):
        db_session.execute(text("UPDATE punches SET direction = 'out'"))
    db_session.rollback()


def test_a_wrong_code_or_name_stops_the_tool_and_changes_nothing(
    boss: TestClient, db_session: Session
) -> None:
    real = create_plant(boss, db_session, "K134")
    Worker(boss, real, "101")
    make_gate(db_session, real, "plant1")

    with pytest.raises(RemovalRefusedError, match="999"):
        build_plan(db_session, "K134", ["101", "999"], ["plant1"])
    with pytest.raises(RemovalRefusedError, match="plant9"):
        build_plan(db_session, "K134", ["101"], ["plant9"])
    with pytest.raises(RemovalRefusedError):
        build_plan(db_session, "NOPLANT", ["101"], [])
    with pytest.raises(RemovalRefusedError):
        build_plan(db_session, "K134", [], [])
    assert count(db_session, Employee) == 1 and count(db_session, KioskDevice) == 1


def test_a_code_of_another_plant_is_not_found(boss: TestClient, db_session: Session) -> None:
    create_plant(boss, db_session, "K134")
    other = create_plant(boss, db_session, "X280")
    Worker(boss, other, "201")

    with pytest.raises(RemovalRefusedError, match="201"):
        build_plan(db_session, "K134", ["201"], [])


def test_somebody_elses_punch_at_a_typed_device_is_refused(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    real = create_plant(boss, db_session, "K134")
    shared_gate = make_gate(db_session, real, "plant1")
    punch_at(boss, shared_gate, Worker(boss, real, "101"))
    punch_at(boss, shared_gate, Worker(boss, real, "REAL-1"))

    with pytest.raises(RemovalRefusedError, match="not in your list"):
        build_plan(db_session, "K134", ["101"], ["plant1"])
    assert count(db_session, Punch) == 2


def test_too_many_employees_in_one_run_are_refused(boss: TestClient, db_session: Session) -> None:
    create_plant(boss, db_session, "K134")
    codes = [str(1000 + number) for number in range(MAX_EMPLOYEES + 1)]

    with pytest.raises(RemovalRefusedError, match="at most"):
        build_plan(db_session, "K134", codes, [])


def test_a_refused_scan_that_names_nobody_needs_its_own_flag(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    real = create_plant(boss, db_session, "K134")
    test_gate = make_gate(db_session, real, "plant1")
    punch_at(boss, test_gate, Worker(boss, real, "101"))
    noise = send(boss, test_gate, "UPS1.not-a-card").json()
    assert noise["decision"] == "rejected" and noise["employee"] is None

    # Without the flag the tool stops and shows what it found (a time, a decision, a code).
    with pytest.raises(RemovalRefusedError, match="names nobody") as refused:
        build_plan(db_session, "K134", ["101"], ["plant1"])
    assert "--include-unidentified-punches" in str(refused.value)
    assert "QR_FORMAT_INVALID" in str(refused.value)

    # With the flag both the employee's punch and the noise go.
    plan = build_plan(db_session, "K134", ["101"], ["plant1"], include_unidentified=True)
    assert plan.counts["punches"] == 2
    remove(db_session, plan)
    db_session.commit()
    assert count(db_session, Punch) == 0


def test_the_flag_never_covers_a_real_persons_punch(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    real = create_plant(boss, db_session, "K134")
    shared_gate = make_gate(db_session, real, "plant1")
    punch_at(boss, shared_gate, Worker(boss, real, "101"))
    punch_at(boss, shared_gate, Worker(boss, real, "REAL-1"))
    send(boss, shared_gate, "UPS1.not-a-card")

    with pytest.raises(RemovalRefusedError, match="employee REAL-1"):
        build_plan(db_session, "K134", ["101"], ["plant1"], include_unidentified=True)
    assert count(db_session, Punch) == 3
