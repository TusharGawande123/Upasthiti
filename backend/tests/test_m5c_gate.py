# ruff: noqa: F811  (fixtures come from the existing gate tests)
"""A converted worker at the gate (M5c spec §7 rules 16 and 17; AC-21, AC-22): until the face is
enrolled the old card and the face are refused; after the enrolment a face punch works and the
"Face enrolment pending" mark goes away. Real PostgreSQL, fake face engine."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.punches.models import Punch
from tests.face_helpers import AGREE, enrol
from tests.kiosk_helpers import Device
from tests.test_face_punch_api import (  # noqa: F401
    boss,
    device,
    face_punch,
    k134,
    kiosk,
    snapshot_folder,
)
from tests.test_punch_api import Worker, make_worker, send

pytestmark = pytest.mark.time_sensitive

EMPLOYEES = "/api/v1/employees"


def convert_now(boss: TestClient, worker: Worker) -> None:
    done = boss.post(
        f"{EMPLOYEES}/{worker.employee_id}/convert-to-permanent",
        json={"effective_from": today_ist().isoformat(), "reason": "Permanent offer"},
    )
    assert done.status_code == 200, done.text


@pytest.fixture
def converted(boss: TestClient, db_session: Session, k134, snapshot_folder: Path) -> Worker:
    worker = make_worker(boss, db_session, k134)
    convert_now(boss, worker)
    return worker


def rows(session: Session) -> list[Punch]:
    session.expire_all()
    return list(session.scalars(select(Punch).order_by(Punch.server_received_at)))


def test_the_old_card_is_refused_at_the_gate_after_the_conversion(
    db_client: TestClient, db_session: Session, device: Device, kiosk, converted: Worker
) -> None:
    """AC-21: the card is blocked and nothing is stored as accepted."""
    answer = send(db_client, device, converted.qr_text).json()

    assert answer["decision"] == "rejected"
    assert answer["reason_code"] == "QR_REVOKED"
    assert answer["employee"] is None
    assert [punch.decision for punch in rows(db_session)] == ["rejected"]


def test_a_face_that_is_not_enrolled_yet_is_not_recognised(
    db_client: TestClient, db_session: Session, device: Device, kiosk, converted: Worker
) -> None:
    """AC-21: the converted person has no face template, so a face punch is refused."""
    answer = face_punch(db_client, device, person=1).json()

    assert answer["decision"] == "rejected"
    assert answer["reason_code"] == "FACE_NOT_RECOGNISED"
    assert all(punch.decision != "accepted" for punch in rows(db_session))


def test_after_the_enrolment_the_face_punch_works_and_the_pending_mark_goes(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk,
    converted: Worker,
) -> None:
    """AC-22: consent first (the Super Admin records it), then five poses, then a face punch."""
    employee_id = str(converted.employee_id)
    assert boss.get(f"{EMPLOYEES}/{employee_id}").json()["employee"]["face_enrolment_pending"]
    given = boss.post(f"{EMPLOYEES}/{employee_id}/face/consent", json=AGREE)
    assert given.status_code == 201, given.text

    assert enrol(boss, employee_id, person=1).status_code == 201

    after = boss.get(f"{EMPLOYEES}/{employee_id}").json()["employee"]
    assert after["face_enrolment_pending"] is False
    answer = face_punch(db_client, device, person=1).json()
    assert (answer["decision"], answer["direction"]) == ("accepted", "in")
    assert uuid.UUID(employee_id) in {punch.employee_id for punch in rows(db_session)}
