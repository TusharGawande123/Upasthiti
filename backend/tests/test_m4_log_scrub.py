"""AC-32: no log line of sync, heartbeat or review traffic holds a signed item, a signature,
sealed evidence, card text, a typed code, a face frame, a time-anchor token, a review reason or a
key (spec M4 §8.2, plan "never logged"). One run with every kind of traffic, all logs captured at
DEBUG, then a search for each secret that was sent or made."""

import base64
import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utc_now
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.image_helpers import make_jpeg
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.offline_helpers import OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker

HEARTBEAT = "/api/v1/kiosk/heartbeat"
TYPED_CODE = "1043"
REVIEW_REASON = "Checked with the shift supervisor Zephyrine"


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


def heartbeat(client: TestClient, device: Device) -> tuple[Any, dict[str, str]]:
    """Sends one heartbeat; returns the answer and the signed headers that were sent."""
    body = json.dumps(
        {
            "queue": {"count": 2, "bytes": 51_000},
            "location": {"state": "good", "lat": 19.85, "lon": 75.2, "accuracy_m": 12, "age_s": 3},
            "storage": {"persisted": True, "quota_mb": 5000, "usage_mb": 40, "offline_ready": True},
            "battery": {"level": 0.8, "charging": True},
            "camera_ok": True,
            "app_version": "test",
        }
    ).encode()
    headers = device.headers("POST", HEARTBEAT, body) | {"Content-Type": "application/json"}
    return client.post(HEARTBEAT, content=body, headers=headers), headers


def everything_logged(caplog: pytest.LogCaptureFixture) -> str:
    """The text of every record plus the structured fields the JSON log writer adds."""
    return caplog.text + json.dumps(
        [getattr(record, "fields", None) for record in caplog.records], default=str
    )


def test_sync_heartbeat_and_review_traffic_logs_no_secret(
    db_client: TestClient,
    db_session: Session,
    boss: TestClient,
    k134: PlantIds,
    caplog: pytest.LogCaptureFixture,
) -> None:
    device = Device()
    make_active_kiosk(db_session, k134, device)
    gate = OfflineGate(device)
    gate.take_anchor(utc_now() - timedelta(hours=1))
    worker = Worker(boss, k134)
    employee_id = new_employee(boss, k134, code=TYPED_CODE)
    assert enrol(boss, employee_id, person=1).status_code == 201
    photo = base64.b64encode(make_jpeg()).decode()
    face_frames = [frame(1), frame(1, yaw=25, role="turn"), frame(1)]
    card = gate.item("qr", card_evidence(worker.qr_text, photo))
    face = gate.item(
        "face",
        {"employee_code": TYPED_CODE, "frames": face_frames},
        challenge="turn_left",
        elapsed=timedelta(minutes=40),
    )
    forged = gate.item("qr", card_evidence(worker.qr_text, photo), tamper_after_signing=True)

    with caplog.at_level(logging.DEBUG):
        synced = gate.send(db_client, [card, face, forged])
        beat, beat_headers = heartbeat(db_client, device)
        punch_id = synced.json()["results"][0]["punch_id"]
        reviewed = boss.post(
            f"/api/v1/punches/{punch_id}/reviews",
            json={"action": "confirm", "reason": REVIEW_REASON, "expected_latest_review_id": None},
        )

    assert synced.status_code == 200, synced.text
    assert [r["result"] for r in synced.json()["results"]] == ["saved", "saved", "refused"]
    assert beat.status_code == 200, beat.text
    # The card punch was not flagged, so the review is refused: the request still ran and logged.
    assert reviewed.status_code in (201, 409)
    logged = everything_logged(caplog)
    assert "request finished" in logged  # the capture works

    settings = get_settings()
    keys = [settings.app_secret_key] + [
        key.get_secret_value()
        for key in (
            settings.offline_evidence_key,
            settings.qr_signing_key,
            settings.snapshot_encryption_key,
            settings.face_template_key,
        )
        if key is not None
    ]
    secrets_sent = {
        "a signed item": [item["signed_item"] for item in (card, face, forged)],
        "an item signature": [item["signature"] for item in (card, face, forged)],
        "sealed evidence": [
            json.loads(item["signed_item"])["evidence"][part]
            for item in (card, face, forged)
            for part in ("ciphertext", "ephemeral_public_key", "nonce")
        ],
        "a time-anchor token": [
            json.loads(card["signed_item"])["time"]["anchor"]["token"],
            synced.json()["time_anchor"]["token"],
            beat.json()["time_anchor"]["token"],
        ],
        "the card text": [worker.qr_text],
        "the typed code inside the evidence": [f'"employee_code": "{TYPED_CODE}"'],
        "a face frame": [entry["jpeg"][:60] for entry in face_frames],
        "a photo": [photo[:60]],
        "a request signature": [beat_headers["X-Kiosk-Signature"]],
        "the review reason": [REVIEW_REASON],
        "a key": [key for key in keys if key],
    }
    for what, values in secrets_sent.items():
        for value in values:
            assert value and value not in logged, f"{what} reached the logs"
