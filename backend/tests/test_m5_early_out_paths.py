"""The early-OUT alert on the other paths (decision 0036 lines 9 and 13): a face punch, the typed
code after an unsure face, and an offline card punch (no alert possible: a mark at sync).
The plant's default shift is 07:00-19:00, half day 4 hours; the clock is frozen on 29/10/2026."""

import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, new_employee, set_privacy
from tests.kiosk_helpers import GATE_LOCATION, Device, make_active_kiosk
from tests.offline_helpers import OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_face_punch_api import code_try, face_punch, signed_post
from tests.test_punch_api import make_worker, photo_text

THURSDAY = date(2026, 10, 29)
CONFIRM = "/api/v1/punch/kiosk/early-out/confirm"


def at(hour: int, minute: int = 0):
    return frozen_at(ist(THURSDAY, hour, minute))


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict[str, Any]:
    """Two look-alike face employees (codes 2001, 2002) and a card worker at one DEMO plant."""
    with at(6):
        set_privacy(db_session)
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant: PlantIds = create_plant(boss, db_session, "DEMO1")
        device = Device()
        kiosk = make_active_kiosk(db_session, plant, device)
        first = new_employee(boss, plant, code="2001")
        enrol(boss, first, person=1)
        second = new_employee(boss, plant, code="2002")
        enrol(boss, second, person=2)
        worker = make_worker(boss, db_session, plant)
    return {
        "client": boss,
        "device": device,
        "kiosk": kiosk,
        "first": first,
        "worker": worker,
        "session": db_session,
    }


def confirm(world: dict, prompt: dict, **extra: Any):
    body = {
        "client_punch_id": prompt["client_punch_id"],
        "token": prompt["token"],
        "location": GATE_LOCATION,
        "app_version": "test",
        **extra,
    }
    return signed_post(world["client"], world["device"], CONFIRM, body)


def punch_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Punch)) or 0


def test_a_face_out_before_the_shift_end_asks_and_agree_keeps_the_face_scores(
    world: dict,
) -> None:
    client, device, session = world["client"], world["device"], world["session"]
    with at(9):
        first = face_punch(client, device, person=1).json()
    punch_id = str(uuid.uuid4())
    with at(10, 10):
        asked = face_punch(client, device, person=1, client_punch_id=punch_id).json()
    stored_while_asking = punch_count(session)
    with at(10, 11):
        agreed = confirm(world, asked["early_out"])

    assert (first["decision"], first["direction"]) == ("accepted", "in")
    assert asked["decision"] == "needs_confirmation" and asked["punch_id"] is None
    assert asked["early_out"]["tier"] == "before_half"
    assert asked["employee"] is None and stored_while_asking == 1
    assert agreed.status_code == 200, agreed.text
    assert (agreed.json()["decision"], agreed.json()["direction"]) == ("accepted", "out")
    row = session.scalars(select(Punch).where(Punch.client_punch_id == uuid.UUID(punch_id))).one()
    assert row.method == "face" and row.early_out_mark == "EARLY_OUT_CONFIRMED"
    assert row.match_score is not None and row.face_model_id  # what the face match proved is kept
    assert row.reason_codes == []  # a mark, not a flag


def test_a_face_out_after_the_shift_end_needs_no_alert(world: dict) -> None:
    client, device = world["client"], world["device"]
    with at(9):
        face_punch(client, device, person=1)

    with at(19, 5):
        answer = face_punch(client, device, person=1).json()

    assert (answer["decision"], answer["direction"]) == ("accepted", "out")


def test_the_typed_code_path_asks_too_and_agree_keeps_the_code_facts(world: dict) -> None:
    client, device, session = world["client"], world["device"], world["session"]
    with at(9):
        token = face_punch(client, device, person=14).json()["code_entry"]["token"]
        assert code_try(client, device, token, "2001").json()["direction"] == "in"
    with at(10, 10):
        token = face_punch(client, device, person=14).json()["code_entry"]["token"]
        asked = code_try(client, device, token, "2001").json()
    with at(10, 11):
        agreed = confirm(world, asked["early_out"])

    assert asked["decision"] == "needs_confirmation"
    assert agreed.status_code == 200, agreed.text
    assert agreed.json()["direction"] == "out"
    row = session.scalars(select(Punch).where(Punch.early_out_mark.is_not(None))).one()
    assert row.match_mode == "code" and row.follows_punch_id is not None
    assert row.claimed_employee_id == row.employee_id == uuid.UUID(world["first"])


def test_a_token_from_another_device_is_refused(world: dict, db_session: Session) -> None:
    client, device = world["client"], world["device"]
    with at(9):
        face_punch(client, device, person=1)
    with at(10, 10):
        asked = face_punch(client, device, person=1).json()
    other = Device()
    make_active_kiosk(
        db_session,
        PlantIds(str(world["kiosk"].plant_id), "DEMO1", "", "", ""),
        other,
        name="Second gate",
    )

    with at(10, 11):
        refused = signed_post(
            client,
            other,
            CONFIRM,
            {
                "client_punch_id": asked["early_out"]["client_punch_id"],
                "token": asked["early_out"]["token"],
                "location": GATE_LOCATION,
            },
        )

    assert refused.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"


def test_an_offline_early_out_is_saved_at_sync_with_the_offline_mark(world: dict) -> None:
    """No alert offline: the gate does not know who the person is or whether it is an OUT."""
    client, device, worker, session = (
        world["client"],
        world["device"],
        world["worker"],
        world["session"],
    )
    gate = OfflineGate(device)
    with at(14):
        gate.take_anchor(ist(THURSDAY, 13, 0))
        later = gate.item(
            "qr", card_evidence(worker.qr_text, photo_text()), elapsed=timedelta(minutes=50)
        )
        earlier = gate.item(
            "qr", card_evidence(worker.qr_text, photo_text()), elapsed=timedelta(minutes=10)
        )
        response = gate.send(client, [later, earlier])

    assert response.status_code == 200, response.text
    assert [r["decision"] for r in response.json()["results"]] == ["accepted", "accepted"]
    first, second = session.scalars(select(Punch).order_by(Punch.punch_time)).all()
    assert (first.direction, first.early_out_mark) == ("in", None)
    assert (second.direction, second.early_out_mark) == ("out", "EARLY_OUT_OFFLINE")
    assert second.decision == "accepted" and second.reason_codes == []


def test_a_face_out_too_soon_after_the_in_is_refused(world: dict) -> None:
    """AC-40, face path: 30 minutes must pass after the IN (setting min_minutes_before_out)."""
    client, device = world["client"], world["device"]
    with at(9):
        face_punch(client, device, person=1)

    with at(9, 29):
        too_soon = face_punch(client, device, person=1).json()
    with at(9, 31):
        later = face_punch(client, device, person=1).json()

    assert too_soon["decision"] == "rejected" and too_soon["reason_code"] == "OUT_TOO_SOON"
    # After the minimum the OUT is a real one (here it asks, as it is before the shift end).
    assert later["decision"] == "needs_confirmation"


def test_an_offline_out_too_soon_after_the_in_is_rejected_at_sync(world: dict) -> None:
    """AC-40, offline path: the server applies the same minimum when the sealed punch arrives."""
    client, device, worker, session = (
        world["client"],
        world["device"],
        world["worker"],
        world["session"],
    )
    gate = OfflineGate(device)
    with at(14):
        gate.take_anchor(ist(THURSDAY, 13, 0))
        first = gate.item(
            "qr", card_evidence(worker.qr_text, photo_text()), elapsed=timedelta(minutes=10)
        )
        second = gate.item(
            "qr", card_evidence(worker.qr_text, photo_text()), elapsed=timedelta(minutes=25)
        )
        response = gate.send(client, [first, second])

    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert results[0]["decision"] == "accepted"
    assert results[1]["decision"] == "rejected" and results[1]["reason_code"] == "OUT_TOO_SOON"
    assert (
        session.scalar(select(func.count()).select_from(Punch).where(Punch.decision == "accepted"))
        == 1
    )
