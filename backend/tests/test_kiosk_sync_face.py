"""Offline FACE punches at sync (M4 spec §7 rule 10, decision 0025 item 2; AC-17, AC-18).

The device chose the head turn and typed the employee code; the server checks the pictures with
the M3 rules and compares the face with that one person (1:1). Frames come from the fake face
engine (painted pictures), as in the online face tests."""

import threading
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.face.fake_engine import FakeFaceModels
from app.modules.face.engine_provider import get_face_engine
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.offline_helpers import OfflineGate
from tests.people_helpers import PlantIds, client_for, create_plant


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds) -> KioskDevice:
    return make_active_kiosk(db_session, k134, Device())


@pytest.fixture
def gate(db_session: Session, k134: PlantIds, boss: TestClient) -> OfflineGate:
    device = Device()
    make_active_kiosk(db_session, k134, device, name="Face gate")
    fake = OfflineGate(device)
    fake.take_anchor(utc_now() - timedelta(hours=1))
    return fake


@pytest.fixture
def ravi(boss: TestClient, k134: PlantIds) -> str:
    """Person 1, enrolled at K134 with code 1043."""
    employee_id = new_employee(boss, k134, code="1043")
    assert enrol(boss, employee_id, person=1).status_code == 201
    return employee_id


def face_evidence(person: int, code: str, *, turn_person: int | None = None, yaw: float = 25.0):
    return {
        "employee_code": code,
        "frames": [
            frame(person),
            frame(turn_person or person, yaw=yaw, role="turn"),
            frame(person),
        ],
    }


def face_item(gate: OfflineGate, evidence: dict, **options):
    options.setdefault("challenge", "turn_left")
    return gate.item("face", evidence, **options)


def rows(session: Session) -> list[Punch]:
    return list(session.scalars(select(Punch).order_by(Punch.punch_time)))


def test_the_right_code_and_face_are_accepted_with_a_kept_photo(
    db_client: TestClient, db_session: Session, gate: OfflineGate, ravi: str
) -> None:
    item = face_item(gate, face_evidence(1, "1043"))

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["result"] == "saved" and result["decision"] == "accepted"
    (punch,) = rows(db_session)
    assert punch.method == "face" and punch.match_mode == "code" and punch.was_offline
    assert str(punch.employee_id) == ravi and punch.claimed_employee_id == punch.employee_id
    assert punch.direction == "in" and punch.challenge == "turn_left"
    assert punch.match_score is not None and float(punch.match_score) > 0.99
    snapshot = db_session.scalars(select(PunchSnapshot)).one()
    assert snapshot.reason == "face_offline"  # every offline face punch keeps one photo


def test_someone_elses_face_with_a_typed_code_is_not_recognised(
    db_client: TestClient, db_session: Session, gate: OfflineGate, ravi: str
) -> None:
    item = face_item(gate, face_evidence(5, "1043"))  # person 5 types Ravi's code

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "rejected" and result["reason_code"] == "FACE_NOT_RECOGNISED"
    (punch,) = rows(db_session)
    assert punch.employee_id is None and str(punch.claimed_employee_id) == ravi


def test_an_unknown_code_is_not_recognised_with_the_same_answer(
    db_client: TestClient, gate: OfflineGate, ravi: str
) -> None:
    item = face_item(gate, face_evidence(1, "NOBODY"))

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "FACE_NOT_RECOGNISED"


@pytest.mark.parametrize("challenge", [None, "turn_right_then_left", "left_then_right"])
def test_a_challenge_that_is_not_valid_for_the_setting_is_refused(
    db_client: TestClient, gate: OfflineGate, ravi: str, challenge: str | None
) -> None:
    # face_challenge_steps is 1, so only turn_left and turn_right are valid.
    item = gate.item("face", face_evidence(1, "1043"), challenge=challenge)
    if challenge == "turn_right_then_left":  # not even a known name: the item is invalid
        assert gate.send(db_client, [item]).json()["results"][0]["reason_code"] == "ITEM_INVALID"
        return

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "OFFLINE_CHALLENGE_INVALID"


def test_a_head_that_turns_the_other_way_fails_liveness(
    db_client: TestClient, gate: OfflineGate, ravi: str
) -> None:
    # The device chose "turn_left" but the pictures turn right.
    item = face_item(gate, face_evidence(1, "1043", yaw=-25.0), challenge="turn_left")

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "LIVENESS_FAILED"


def test_the_face_of_an_employee_of_another_plant_is_wrong_plant(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    k134: PlantIds,
) -> None:
    other = create_plant(boss, db_session, "TP1")
    employee_id = new_employee(boss, other, code="3001")
    assert enrol(boss, employee_id, person=3).status_code == 201

    (result,) = gate.send(db_client, [face_item(gate, face_evidence(3, "3001"))]).json()["results"]

    assert result["reason_code"] == "WRONG_PLANT"
    assert len(db_session.scalars(select(PunchSnapshot)).all()) == 1  # the photo is kept


def test_a_busy_face_worker_keeps_the_item_for_later(
    db_app: FastAPI,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    ravi: str,
) -> None:
    """Live punches go first: a sync face item never waits for the worker (AC-18)."""
    engine = FaceEngine(FakeFaceModels)
    engine.load_now()
    db_app.dependency_overrides[get_face_engine] = lambda: engine
    release, started = threading.Event(), threading.Event()

    def hold(models: object) -> None:
        started.set()
        release.wait(timeout=5)

    holder = threading.Thread(target=engine.run, args=(hold,))
    holder.start()
    started.wait(timeout=5)
    item = face_item(gate, face_evidence(1, "1043"))
    busy = gate.send(db_client, [item]).json()["results"][0]
    release.set()
    holder.join(timeout=5)

    assert busy["result"] == "retry_later"
    assert rows(db_session) == []  # nothing was decided or stored
    again = gate.send(db_client, [item]).json()["results"][0]
    assert again["result"] == "saved" and again["decision"] == "accepted"
