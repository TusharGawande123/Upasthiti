"""The early-OUT alert at the gate (decision 0036 lines 9 and 13): an OUT before the shift end is
not stored at once; the gate gets the time that is left and a token, and Agree stores the OUT.
Card punches through the real endpoints, the clock frozen. The plant's default shift is
07:00-19:00 with a half day of 4 hours, so a person who comes in at 09:00 completes the half
shift at 13:00."""

import json
import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.kiosk_helpers import GATE_LOCATION, Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, make_worker, photo_text, send

THURSDAY = date(2026, 10, 29)
CONFIRM = "/api/v1/punch/kiosk/early-out/confirm"


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    yield


@pytest.fixture
def gate(db_app: FastAPI, db_session: Session) -> tuple[TestClient, Device, PlantIds, Worker]:
    with frozen_at(ist(THURSDAY, 6, 0)):
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant = create_plant(boss, db_session, "DEMO1")
        device = Device()
        make_active_kiosk(db_session, plant, device)
        worker = make_worker(boss, db_session, plant)
    return boss, device, plant, worker


def scan(gate: tuple, hour: int, minute: int = 0, **extra: Any) -> dict:
    client, device, _plant, worker = gate
    with frozen_at(ist(THURSDAY, hour, minute)):
        response = send(client, device, worker.qr_text, **extra)
    assert response.status_code == 200, response.text
    return response.json()


def agree(gate: tuple, token: str, punch_id: str, hour: int, minute: int = 0, **extra: Any):
    client, device, _plant, _worker = gate
    body = {
        "client_punch_id": punch_id,
        "token": token,
        "snapshot_jpeg": photo_text(),
        "location": GATE_LOCATION,
        "app_version": "test",
        **extra,
    }
    raw = json.dumps(body).encode()
    headers = device.headers("POST", CONFIRM, raw) | {"Content-Type": "application/json"}
    with frozen_at(ist(THURSDAY, hour, minute)):
        return client.post(CONFIRM, content=raw, headers=headers)


def count_punches(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Punch)) or 0


def test_an_out_before_the_half_shift_asks_first_and_stores_nothing(
    gate: tuple, db_session: Session
) -> None:
    scan(gate, 9)
    stored_before = count_punches(db_session)

    answer = scan(gate, 10, 10)

    assert answer["decision"] == "needs_confirmation" and answer["punch_id"] is None
    prompt = answer["early_out"]
    assert prompt["tier"] == "before_half"
    assert prompt["half_remaining_min"] == 170  # the half shift is complete at 13:00
    assert prompt["full_remaining_min"] == 530  # the shift ends at 19:00
    assert answer["employee"] is None  # no name on the gate screen
    assert count_punches(db_session) == stored_before


def test_an_out_after_the_half_shift_but_before_the_end_has_the_softer_alert(gate: tuple) -> None:
    scan(gate, 9)

    prompt = scan(gate, 15, 25)["early_out"]

    assert prompt["tier"] == "before_end"
    assert prompt["half_remaining_min"] is None
    assert prompt["full_remaining_min"] == 215


def test_an_out_at_or_after_the_shift_end_needs_no_alert(gate: tuple) -> None:
    scan(gate, 9)

    answer = scan(gate, 19)

    assert (answer["decision"], answer["direction"]) == ("accepted", "out")


def test_agree_stores_the_out_with_the_mark_and_the_day_counts_it(
    gate: tuple, db_session: Session
) -> None:
    scan(gate, 9)
    punch_id = str(uuid.uuid4())
    asked = scan(gate, 10, 10, client_punch_id=punch_id)

    agreed = agree(gate, asked["early_out"]["token"], punch_id, 10, 11)

    assert agreed.status_code == 200, agreed.text
    body = agreed.json()
    assert (body["decision"], body["direction"]) == ("accepted", "out")
    row = db_session.scalars(
        select(Punch).where(Punch.client_punch_id == uuid.UUID(punch_id))
    ).one()
    assert row.early_out_mark == "EARLY_OUT_CONFIRMED"
    assert row.decision == "accepted" and row.reason_codes == []  # a mark, not a flag
    # The same Agree sent again (a lost answer) gets the same answer and no second row.
    again = agree(gate, asked["early_out"]["token"], punch_id, 10, 12)
    assert again.json()["punch_id"] == body["punch_id"]
    assert count_punches(db_session) == 2


def test_cancel_records_nothing_and_the_person_can_punch_again_later(
    gate: tuple, db_session: Session
) -> None:
    scan(gate, 9)
    scan(gate, 10, 10)  # the alert; the gate sends nothing more: Cancel
    after_cancel = count_punches(db_session)

    later = scan(gate, 19, 5)

    assert after_cancel == 1  # only the IN
    assert (later["decision"], later["direction"]) == ("accepted", "out")


def test_a_token_is_for_one_device_one_punch_and_ninety_seconds(gate: tuple) -> None:
    scan(gate, 9)
    token = scan(gate, 10, 10)["early_out"]["token"]

    other_punch = agree(gate, token, str(uuid.uuid4()), 10, 11)
    too_late = agree(gate, token, str(uuid.uuid4()), 10, 12)
    forged = agree(gate, token[:-4] + "AAAA", str(uuid.uuid4()), 10, 11)

    assert other_punch.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"
    assert too_late.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"
    assert forged.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"


def test_after_an_agreed_out_the_shift_is_closed_for_the_day(gate: tuple) -> None:
    """Agree stores a normal OUT, so one IN and one OUT per shift holds for the rest of the day."""
    scan(gate, 9)
    punch_id = str(uuid.uuid4())
    token = scan(gate, 10, 10, client_punch_id=punch_id)["early_out"]["token"]
    agreed = agree(gate, token, punch_id, 10, 11)

    later = scan(gate, 10, 20)

    assert agreed.json()["direction"] == "out"
    assert later["reason_code"] == "SHIFT_ALREADY_CLOSED"


def test_the_gate_answer_keeps_its_old_shape_for_an_in(gate: tuple) -> None:
    answer = scan(gate, 9)

    assert (answer["decision"], answer["direction"]) == ("accepted", "in")
    assert answer["early_out"] is None
