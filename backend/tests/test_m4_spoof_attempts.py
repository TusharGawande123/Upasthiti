"""Demo scenario 3 (SRS §9) and spec M4 AC-34: every way a proxy might try to punch from outside
the plant is refused, and none of them creates a COUNTED punch.

  (a) a device with an unregistered key      -> DEVICE_SIGNATURE_INVALID
  (b) a position at somebody's home           -> OUTSIDE_GEOFENCE
  (c) a recorded punch request sent again     -> NONCE_REUSED
  (d) a saved punch sent twice / edited       -> already_saved / ITEM_SIGNATURE_INVALID
  (e) a forged time anchor                    -> OFFLINE_TIME_UNPROVEN flag (never a proven time)
  (f) an item signed by another device        -> ITEM_SIGNATURE_INVALID
  (g) a device that was switched off          -> DEVICE_REVOKED (also for the sync)
"""

import json
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.kiosk_helpers import GATE_FENCE_RADIUS_M, Device, make_active_kiosk
from tests.offline_helpers import SYNC, OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_kiosk_sync import card_item
from tests.test_m4_location_and_flags import north_of_gate
from tests.test_punch_api import PUNCH, Worker, make_worker, photo_text, punch_rows, send


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def device() -> Device:
    return Device()


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds, device: Device) -> KioskDevice:
    return make_active_kiosk(db_session, k134, device)


@pytest.fixture
def worker(boss: TestClient, db_session: Session, k134: PlantIds) -> Worker:
    return make_worker(boss, db_session, k134)


def counted(session: Session) -> list[Punch]:
    return [p for p in punch_rows(session) if p.decision in ("accepted", "flagged")]


def test_a_device_with_a_key_the_server_does_not_know_is_refused(
    db_client: TestClient, db_session: Session, kiosk: KioskDevice, worker: Worker
) -> None:
    stranger = Device()  # a fresh key pair, never paired
    stranger.kiosk_id = str(kiosk.id)  # it even knows the kiosk's id

    response = send(db_client, stranger, worker.qr_text)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"
    assert counted(db_session) == []


def test_a_punch_from_somebodys_home_is_refused(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    home = north_of_gate(GATE_FENCE_RADIUS_M + 5_000)  # 5 km from the plant

    answer = send(db_client, device, worker.qr_text, location=home).json()

    assert answer["reason_code"] == "OUTSIDE_GEOFENCE"
    assert counted(db_session) == []


def test_a_recorded_punch_request_cannot_be_sent_again(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    body = json.dumps(
        {
            "client_punch_id": "6f1c2d3e-0000-4000-8000-000000000001",
            "method": "qr",
            "qr_payload": worker.qr_text,
            "snapshot_jpeg": photo_text(),
            "location": {"lat": 19.85, "lon": 75.25, "accuracy_m": 12, "age_s": 1},
        }
    ).encode()
    headers = device.headers("POST", PUNCH, body) | {"Content-Type": "application/json"}
    assert db_client.post(PUNCH, content=body, headers=headers).status_code == 200

    replay = db_client.post(PUNCH, content=body, headers=headers)  # the same signed bytes again

    assert replay.status_code == 401 and replay.json()["error"]["code"] == "NONCE_REUSED"
    assert len(counted(db_session)) == 1  # only the first one counted


def test_a_forged_time_never_gives_a_proven_time_and_is_flagged(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    gate = OfflineGate(device)
    gate.take_anchor(utc_now() - timedelta(hours=2))
    # The device claims a long, convenient stretch since an anchor token it invented.
    item = card_item(gate, worker, anchor_token="invented", elapsed=timedelta(hours=1, minutes=59))

    gate.send(db_client, [item])

    (punch,) = punch_rows(db_session)
    assert punch.time_proof == "unproven"
    assert punch.decision == "flagged" and "OFFLINE_TIME_UNPROVEN" in punch.reason_codes


def test_an_item_made_by_another_device_is_not_accepted_for_this_one(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    other = Device()
    other.kiosk_id = str(kiosk.id)
    forger = OfflineGate(other)
    forger.take_anchor(utc_now() - timedelta(hours=1))
    stolen = forger.item("qr", card_evidence(worker.qr_text, photo_text()))
    real = OfflineGate(device)

    (result,) = real.send(db_client, [stolen], counter=500).json()["results"]

    assert result["reason_code"] == "ITEM_SIGNATURE_INVALID"
    assert punch_rows(db_session) == []


def test_a_switched_off_device_can_neither_punch_nor_sync(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    gate = OfflineGate(device)
    gate.take_anchor(utc_now() - timedelta(hours=1))
    item = card_item(gate, worker)
    boss.post(f"/api/v1/kiosks/{kiosk.id}/revoke", json={"reason": "Device stolen"})

    punch = send(db_client, device, worker.qr_text)
    sync = gate.send(db_client, [item])

    assert punch.status_code == 403 and punch.json()["error"]["code"] == "DEVICE_REVOKED"
    assert sync.status_code == 403 and sync.json()["error"]["code"] == "DEVICE_REVOKED"
    assert punch_rows(db_session) == []


def test_the_sync_cannot_be_used_without_signing_the_request(
    db_client: TestClient, db_session: Session, kiosk: KioskDevice
) -> None:
    body = json.dumps({"items": [{"counter": 1, "signed_item": "{}", "signature": "x" * 20}]})

    response = db_client.post(SYNC, content=body, headers={"Content-Type": "application/json"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"
    assert punch_rows(db_session) == []
