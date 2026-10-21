"""The kiosk punch endpoint and the kiosk error report, end to end through the signed API
(spec M2 §5.2, §7; AC-7 to AC-19, AC-20, AC-32, AC-42, AC-44). Real PostgreSQL, fake data."""

import io
import json
import logging
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import SnapshotDecryptionError, decode_key, decrypt_snapshot
from app.core.storage import StorageError, get_storage
from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.auth.rate_limit import punch_limiter
from app.modules.kiosks.models import KioskDevice
from app.modules.punches import service as punch_service
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import build_payload
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.image_helpers import make_jpeg
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body

PUNCH = "/api/v1/punch/kiosk"
REPORT = "/api/v1/kiosk/report"


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Photos go to a temporary folder, never to the project's own .storage."""
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
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


@pytest.fixture
def device() -> Device:
    return Device()


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds, device: Device) -> KioskDevice:
    return make_active_kiosk(db_session, k134, device)


class Worker:
    def __init__(self, boss: TestClient, plant: PlantIds, code: str = "T-1") -> None:
        body = temporary_body(plant) | {"employee_code": code, "full_name": "Asha Kale"}
        employee = boss.post("/api/v1/employees", json=body).json()
        card = boss.post(f"/api/v1/employees/{employee['id']}/qr-cards", json={}).json()["card"]
        self.employee_id = uuid.UUID(employee["id"])
        self.card_id = uuid.UUID(card["id"])
        self.serial: str = card["serial"]
        self.qr_text = build_payload(get_settings(), self.serial)


@pytest.fixture
def worker(boss: TestClient, k134: PlantIds) -> Worker:
    return Worker(boss, k134)


def photo_text(**kwargs: object) -> str:
    import base64

    return base64.b64encode(make_jpeg(**kwargs)).decode()  # type: ignore[arg-type]


def send(
    client: TestClient,
    device: Device,
    qr_text: str,
    *,
    client_punch_id: uuid.UUID | None = None,
    snapshot: str | None = "default",
    **extra: Any,
):
    body: dict[str, object] = {
        "client_punch_id": str(client_punch_id or uuid.uuid4()),
        "method": "qr",
        "qr_payload": qr_text,
        "snapshot_jpeg": photo_text() if snapshot == "default" else snapshot,
        "device_time": "2026-10-20T10:00:00+05:30",
        "app_version": "test",
        **extra,
    }
    raw = json.dumps(body).encode()
    headers = device.headers("POST", PUNCH, raw) | {"Content-Type": "application/json"}
    return client.post(PUNCH, content=raw, headers=headers)


def punch_rows(session: Session) -> list[Punch]:
    return list(session.scalars(select(Punch).order_by(Punch.server_received_at)))


def snapshot_rows(session: Session) -> list[PunchSnapshot]:
    return list(session.scalars(select(PunchSnapshot)))


def add_earlier_punch(
    session: Session, kiosk: KioskDevice, worker: Worker, direction: str, age: timedelta
) -> None:
    session.add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=worker.employee_id,
            qr_credential_id=worker.card_id,
            method="qr",
            direction=direction,
            decision="accepted",
            reason_codes=[],
            server_received_at=utc_now() - age,
        )
    )
    session.commit()


# --- Accepted punches -------------------------------------------------------------------------


def test_a_valid_card_is_accepted_as_in_with_an_encrypted_photo(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    response = send(db_client, device, worker.qr_text, snapshot=photo_text(with_metadata=True))

    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["decision"] == "accepted"
    assert answer["direction"] == "in"
    assert answer["reason_code"] is None
    assert answer["employee"] == {"display_name": "Asha Kale", "employee_code": "T-1"}
    assert answer["message_key"] == "kiosk.punch.accepted.in"
    assert answer["voice_key"] == "kiosk.voice.in"
    assert answer["details"]["kiosk_name"] == "Main gate"

    (punch,) = punch_rows(db_session)
    assert str(punch.id) == answer["punch_id"]
    assert punch.plant_id == kiosk.plant_id and punch.employee_id == worker.employee_id
    (snapshot,) = snapshot_rows(db_session)
    assert snapshot.state == "stored" and snapshot.is_dark is False
    assert abs(snapshot.expires_at - snapshot.taken_at - timedelta(days=60)) < timedelta(seconds=1)

    stored = get_storage().read(snapshot.storage_key)
    assert stored[:2] != b"\xff\xd8"  # not a JPEG: it is encrypted
    key = decode_key(get_settings().snapshot_encryption_key.get_secret_value())  # type: ignore[union-attr]
    jpeg = decrypt_snapshot(stored, punch.id, key)
    assert b"Test camera maker" not in jpeg  # the camera data was removed on the server
    assert Image.open(io.BytesIO(jpeg)).size == (320, 240)


def test_a_stored_photo_cannot_be_moved_to_another_punch(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    send(db_client, device, worker.qr_text)
    (snapshot,) = snapshot_rows(db_session)
    key = decode_key(get_settings().snapshot_encryption_key.get_secret_value())  # type: ignore[union-attr]

    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(get_storage().read(snapshot.storage_key), uuid.uuid4(), key)


def test_a_punch_leaves_no_audit_row_and_marks_the_kiosk_seen(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    audit_before = db_session.scalar(select(func.count()).select_from(AuditLog))

    send(db_client, device, worker.qr_text)

    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == audit_before
    db_session.refresh(kiosk)
    assert kiosk.last_seen_at is not None


def test_after_enough_time_the_next_punch_is_an_out(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    add_earlier_punch(db_session, kiosk, worker, "in", timedelta(hours=9))

    answer = send(db_client, device, worker.qr_text).json()

    assert (answer["decision"], answer["direction"]) == ("accepted", "out")
    assert answer["voice_key"] == "kiosk.voice.out"


def test_the_server_clock_decides_not_the_device_clock(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    answer = send(db_client, device, worker.qr_text, device_time="2020-01-01T00:00:00+00:00").json()

    (punch,) = punch_rows(db_session)
    assert abs(punch.server_received_at - utc_now()) < timedelta(minutes=1)
    assert punch.device_claimed_at is not None and punch.device_claimed_at.year == 2020
    assert answer["server_time"].startswith(str(utc_now().year))


def test_a_dark_photo_is_kept_and_marked(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    answer = send(db_client, device, worker.qr_text, snapshot=photo_text(colour=(8, 8, 8))).json()

    assert answer["decision"] == "accepted"
    assert snapshot_rows(db_session)[0].is_dark is True


def test_the_kiosks_location_is_stored_as_sent(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    send(
        db_client,
        device,
        worker.qr_text,
        location={"lat": 19.85, "lon": 75.25, "accuracy_m": 12.5},
    )

    (punch,) = punch_rows(db_session)
    assert float(punch.lat or 0) == 19.85 and float(punch.accuracy_m or 0) == 12.5


# --- "Already punched" ------------------------------------------------------------------------


def test_scanning_twice_in_a_row_shows_already_in_with_the_name_and_no_new_photo(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    first = send(db_client, device, worker.qr_text).json()

    second = send(db_client, device, worker.qr_text).json()

    assert second["decision"] == "rejected" and second["reason_code"] == "COOLDOWN_ACTIVE"
    assert second["employee"]["display_name"] == "Asha Kale"
    assert second["voice_key"] == "kiosk.voice.alreadyIn"
    assert second["details"]["last_direction"] == "in"
    assert second["details"]["last_punch_at"] is not None
    assert len(punch_rows(db_session)) == 2  # the rejected scan is stored...
    assert [row.punch_id for row in snapshot_rows(db_session)] == [uuid.UUID(first["punch_id"])]


def test_an_out_too_soon_names_when_out_is_allowed(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    add_earlier_punch(db_session, kiosk, worker, "in", timedelta(minutes=10))

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["reason_code"] == "OUT_TOO_SOON"
    details = answer["details"]
    assert details["last_direction"] == "in"
    assert details["out_allowed_from"] is not None
    assert snapshot_rows(db_session) == []


# --- Rejections -------------------------------------------------------------------------------


def revoke(boss: TestClient, worker: Worker) -> None:
    done = boss.post(
        f"/api/v1/qr-cards/{worker.card_id}/revoke", json={"kind": "lost", "reason": "Lost it"}
    )
    assert done.status_code == 200, done.text


def test_a_revoked_card_is_rejected_and_the_photo_is_kept_as_evidence(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    revoke(boss, worker)

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "rejected" and answer["reason_code"] == "QR_REVOKED"
    assert answer["direction"] is None
    assert answer["message_key"] == "kiosk.punch.QR_REVOKED"
    assert answer["voice_key"] == "kiosk.punch.QR_REVOKED.voice"
    assert answer["employee"] is None  # a stranger with a lost card learns nothing
    (punch,) = punch_rows(db_session)
    assert punch.decision == "rejected" and punch.reason_codes == ["QR_REVOKED"]
    assert punch.direction is None
    assert len(snapshot_rows(db_session)) == 1


def test_a_card_at_another_plants_gate_is_rejected_without_a_name(
    db_client: TestClient, db_session: Session, tp1: PlantIds, worker: Worker
) -> None:
    other_device = Device()
    make_active_kiosk(db_session, tp1, other_device, "TP1 gate")

    answer = send(db_client, other_device, worker.qr_text).json()

    assert answer["reason_code"] == "WRONG_PLANT"
    assert answer["employee"] is None
    (punch,) = punch_rows(db_session)
    assert punch.plant_id == uuid.UUID(tp1.id) and punch.employee_id == worker.employee_id
    assert len(snapshot_rows(db_session)) == 1


def test_a_card_of_an_employee_on_face_punching_is_rejected(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    from app.modules.employees.models import Employee

    employee = db_session.get(Employee, worker.employee_id)
    assert employee is not None
    employee.punch_method = "face"
    db_session.commit()

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["reason_code"] == "EMPLOYEE_NOT_QR" and answer["employee"] is None


def test_an_expired_card_is_rejected(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    card = db_session.get(QrCredential, worker.card_id)
    assert card is not None
    card.valid_from = utc_now().date() - timedelta(days=40)
    card.valid_until = utc_now().date() - timedelta(days=10)
    db_session.commit()

    assert send(db_client, device, worker.qr_text).json()["reason_code"] == "QR_EXPIRED"


@pytest.mark.parametrize(
    ("qr_text", "code"),
    [("UPS1.not-a-card", "QR_FORMAT_INVALID"), ("", "QR_FORMAT_INVALID")],
)
def test_text_that_is_not_a_card_is_rejected_with_a_photo_and_no_employee(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    qr_text: str,
    code: str,
) -> None:
    answer = send(db_client, device, qr_text).json()

    assert answer["reason_code"] == code
    (punch,) = punch_rows(db_session)
    assert punch.employee_id is None and punch.qr_credential_id is None
    assert len(snapshot_rows(db_session)) == 1


def test_a_forged_card_is_rejected(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    middle = worker.qr_text[-10]
    forged = worker.qr_text[:-10] + ("A" if middle != "A" else "B") + worker.qr_text[-9:]

    answer = send(db_client, device, forged).json()

    assert answer["reason_code"] == "QR_SIGNATURE_INVALID" and answer["employee"] is None


def test_a_missing_photo_is_rejected_and_stored_without_a_snapshot(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    for missing in (None, ""):
        answer = send(db_client, device, worker.qr_text, snapshot=missing).json()
        assert answer["reason_code"] == "SNAPSHOT_MISSING"

    assert len(punch_rows(db_session)) == 2
    assert snapshot_rows(db_session) == []


@pytest.mark.parametrize("bad_photo", ["%%% not base64 %%%", "aGVsbG8="])
def test_a_photo_that_is_not_a_jpeg_is_rejected(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    bad_photo: str,
) -> None:
    answer = send(db_client, device, worker.qr_text, snapshot=bad_photo).json()

    assert answer["reason_code"] == "SNAPSHOT_INVALID"
    assert snapshot_rows(db_session) == []


# --- Test cards -------------------------------------------------------------------------------


def test_a_test_card_shows_kiosk_ok_and_makes_no_punch_and_no_photo(
    boss: TestClient, db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate test"}).json()
    qr_text = build_payload(get_settings(), card["serial"])

    response = send(db_client, device, qr_text)

    answer = response.json()
    assert answer["decision"] == "self_test" and answer["punch_id"] is None
    assert answer["message_key"] == "kiosk.punch.selfTest"
    assert answer["voice_key"] == "kiosk.voice.selfTest"
    assert punch_rows(db_session) == [] and snapshot_rows(db_session) == []
    db_session.refresh(kiosk)
    assert kiosk.last_self_test_at is not None
    used = db_session.get(QrCredential, uuid.UUID(card["id"]))
    assert used is not None and used.last_used_at is not None
    entry = db_session.scalars(select(AuditLog).where(AuditLog.action == "kiosk.self_test")).one()
    assert entry.actor_type == "kiosk" and entry.actor_id == kiosk.id


# --- Retries ----------------------------------------------------------------------------------


def test_a_retry_with_the_same_id_gets_the_same_answer_and_makes_nothing_new(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    punch_id = uuid.uuid4()
    first = send(db_client, device, worker.qr_text, client_punch_id=punch_id)

    again = send(db_client, device, worker.qr_text, client_punch_id=punch_id)

    assert again.status_code == 200
    assert again.json() == first.json()
    assert len(punch_rows(db_session)) == 1 and len(snapshot_rows(db_session)) == 1


def test_a_retry_of_a_cool_down_rejection_repeats_the_same_details(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    send(db_client, device, worker.qr_text)
    punch_id = uuid.uuid4()
    first = send(db_client, device, worker.qr_text, client_punch_id=punch_id).json()

    again = send(db_client, device, worker.qr_text, client_punch_id=punch_id).json()

    assert first["reason_code"] == "COOLDOWN_ACTIVE"
    assert again == first


def test_two_kiosks_may_use_the_same_scan_id(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    side_device = Device()
    make_active_kiosk(db_session, k134, side_device, "Side gate")
    shared_id = uuid.uuid4()

    first = send(db_client, device, worker.qr_text, client_punch_id=shared_id)
    second = send(db_client, side_device, worker.qr_text, client_punch_id=shared_id)

    assert first.json()["punch_id"] != second.json()["punch_id"]
    assert len(punch_rows(db_session)) == 2


def test_when_another_request_wins_the_race_its_answer_is_returned(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    punch_id = uuid.uuid4()
    winner = Punch(
        client_punch_id=punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=worker.employee_id,
        qr_credential_id=worker.card_id,
        method="qr",
        direction="in",
        decision="accepted",
        reason_codes=[],
        server_received_at=utc_now() - timedelta(days=3),
    )
    db_session.add(winner)
    db_session.commit()
    real_find = punch_service._find_punch
    calls: list[int] = []

    def blind_the_first_time(session: Session, kiosk_row: KioskDevice, client_id: uuid.UUID):
        calls.append(1)
        return None if len(calls) == 1 else real_find(session, kiosk_row, client_id)

    monkeypatch.setattr(punch_service, "_find_punch", blind_the_first_time)

    response = send(db_client, device, worker.qr_text, client_punch_id=punch_id)

    assert response.status_code == 200
    assert response.json()["punch_id"] == str(winner.id)
    assert len(punch_rows(db_session)) == 1
    assert snapshot_rows(db_session) == []  # the loser's file was not kept


# --- Storage problems -------------------------------------------------------------------------


class BrokenStorage:
    def save(self, key: str, data: bytes) -> None:
        raise StorageError("down")

    def read(self, key: str) -> bytes:
        raise StorageError("down")

    def delete(self, keys: list[str]) -> None:
        raise StorageError("down")


def test_a_storage_outage_never_stops_the_gate(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(punch_service, "get_storage", BrokenStorage)

    with caplog.at_level(logging.WARNING):
        answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "accepted"
    (snapshot,) = snapshot_rows(db_session)
    assert snapshot.state == "upload_failed" and snapshot.size_bytes == 0
    assert "Snapshot not stored" in caplog.text


# --- Requests that cannot be trusted ----------------------------------------------------------


def test_a_changed_body_is_refused_and_writes_no_punch(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    body = {
        "client_punch_id": str(uuid.uuid4()),
        "method": "qr",
        "qr_payload": worker.qr_text,
        "snapshot_jpeg": photo_text(),
    }
    signed_for = json.dumps(body).encode()
    headers = device.headers("POST", PUNCH, signed_for) | {"Content-Type": "application/json"}
    body["qr_payload"] = "UPS1.changed"

    response = db_client.post(PUNCH, content=json.dumps(body).encode(), headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"
    assert punch_rows(db_session) == []


def test_a_recorded_request_cannot_be_sent_again(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    body = json.dumps(
        {
            "client_punch_id": str(uuid.uuid4()),
            "method": "qr",
            "qr_payload": worker.qr_text,
            "snapshot_jpeg": photo_text(),
        }
    ).encode()
    headers = device.headers("POST", PUNCH, body) | {"Content-Type": "application/json"}
    assert db_client.post(PUNCH, content=body, headers=headers).status_code == 200

    replay = db_client.post(PUNCH, content=body, headers=headers)

    assert replay.status_code == 401 and replay.json()["error"]["code"] == "NONCE_REUSED"
    assert len(punch_rows(db_session)) == 1


def test_a_switched_off_kiosk_cannot_punch(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    boss.post(f"/api/v1/kiosks/{kiosk.id}/revoke", json={"reason": "Device lost"})

    response = send(db_client, device, worker.qr_text)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DEVICE_REVOKED"
    assert punch_rows(db_session) == []


def test_a_request_without_a_signature_is_refused(db_client: TestClient) -> None:
    response = db_client.post(PUNCH, json={"method": "qr"})

    assert response.status_code == 401


def test_a_body_over_64_kb_is_refused_before_it_is_read(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    huge = "A" * 100_000

    response = send(db_client, device, worker.qr_text, snapshot=huge)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert punch_rows(db_session) == []


def test_a_photo_between_40_and_64_kb_is_a_normal_rejection(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    import base64

    too_big_for_a_photo = base64.b64encode(make_jpeg() + b"\0" * 45_000).decode()

    answer = send(db_client, device, worker.qr_text, snapshot=too_big_for_a_photo).json()

    assert answer["reason_code"] == "SNAPSHOT_INVALID"


def test_the_61st_punch_in_a_minute_is_refused(
    db_client: TestClient, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    for _ in range(60):
        punch_limiter.record(str(kiosk.id))

    response = send(db_client, device, worker.qr_text)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "TOO_MANY_REQUESTS"


@pytest.mark.parametrize(
    "change",
    [{"method": "face"}, {"client_punch_id": "not-a-uuid"}, {"qr_payload": "U" * 201}],
)
def test_a_malformed_request_is_a_validation_error_and_writes_no_punch(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    change: dict[str, Any],
) -> None:
    response = send(db_client, device, worker.qr_text, **change)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert punch_rows(db_session) == []


# --- Kiosk error reports ----------------------------------------------------------------------


def report(client: TestClient, device: Device, **changes: object):
    body = {"kind": "camera_error", "message": "Camera stopped", "count": 3} | changes
    raw = json.dumps(body).encode()
    headers = device.headers("POST", REPORT, raw) | {"Content-Type": "application/json"}
    return client.post(REPORT, content=raw, headers=headers)


def test_a_report_is_written_to_the_log_and_not_to_the_database(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    caplog: pytest.LogCaptureFixture,
) -> None:
    audit_before = db_session.scalar(select(func.count()).select_from(AuditLog))

    with caplog.at_level(logging.WARNING):
        response = report(db_client, device, app_version="abc123")

    assert response.status_code == 204
    record = next(r for r in caplog.records if r.getMessage() == "kiosk report")
    fields = record.fields  # type: ignore[attr-defined]
    assert fields["kiosk_id"] == str(kiosk.id) and fields["kind"] == "camera_error"
    assert fields["count"] == 3 and fields["app_version"] == "abc123"
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == audit_before


def test_the_21st_report_in_an_hour_is_refused(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    results = [report(db_client, device).status_code for _ in range(21)]

    assert results[:20] == [204] * 20
    assert results[20] == 429


@pytest.mark.parametrize(
    "change",
    [{"kind": "something_else"}, {"count": 0}, {"count": 101}, {"message": "x" * 301}],
)
def test_a_bad_report_is_a_validation_error(
    db_client: TestClient, device: Device, kiosk: KioskDevice, change: dict[str, object]
) -> None:
    assert report(db_client, device, **change).status_code == 422


def test_a_report_needs_a_paired_kiosk(db_client: TestClient) -> None:
    response = db_client.post(REPORT, json={"kind": "other", "message": "x", "count": 1})

    assert response.status_code == 401


# --- Security review of M2: fixes ---------------------------------------------------------------


def test_a_revoked_test_card_is_refused_and_leaves_no_punch_and_no_photo(
    boss: TestClient, db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate test"}).json()
    boss.post(f"/api/v1/qr-test-cards/{card['id']}/revoke", json={"reason": "Not needed"})

    answer = send(db_client, device, build_payload(get_settings(), card["serial"])).json()

    assert answer["decision"] == "rejected" and answer["reason_code"] == "QR_REVOKED"
    assert answer["punch_id"] is None and answer["employee"] is None
    assert punch_rows(db_session) == [] and snapshot_rows(db_session) == []


def test_a_missing_storage_setting_never_stops_the_gate(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def storage_not_configured() -> None:
        raise StorageError("SUPABASE_URL is not set")

    monkeypatch.setattr(punch_service, "get_storage", storage_not_configured)

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "accepted"
    (snapshot,) = snapshot_rows(db_session)
    assert snapshot.state == "upload_failed"


def test_a_failed_save_leaves_no_photo_file_without_a_row(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the database fails after the photo was uploaded, the file must not stay behind: no
    row would point to it, so the purge job would never delete it (DPDP retention)."""
    files: list[str] = []
    deleted: list[str] = []

    class RecordingStorage:
        def save(self, key: str, data: bytes) -> None:
            files.append(key)

        def read(self, key: str) -> bytes:
            raise StorageError("not used")

        def delete(self, keys: list[str]) -> None:
            deleted.extend(keys)

    monkeypatch.setattr(punch_service, "get_storage", RecordingStorage)
    real_commit = Session.commit
    commits = 0

    def failing_commit(self: Session) -> None:
        nonlocal commits
        commits += 1
        if commits == 1:  # the device check commits first and must work
            real_commit(self)
            return
        raise RuntimeError("the database went away")

    monkeypatch.setattr(Session, "commit", failing_commit)
    try:
        # The app answers an unexpected failure with a 500 (or lets a test client re-raise it).
        try:
            response = send(db_client, device, worker.qr_text)
            assert response.status_code == 500
        except RuntimeError:
            pass
    finally:
        monkeypatch.setattr(Session, "commit", real_commit)

    assert len(files) == 1 and deleted == files
    assert punch_rows(db_session) == []


@pytest.mark.parametrize("accuracy", [1e9, float("inf")])
def test_a_silly_location_accuracy_is_a_validation_error_not_a_server_error(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    accuracy: float,
) -> None:
    body = {
        "client_punch_id": str(uuid.uuid4()),
        "method": "qr",
        "qr_payload": worker.qr_text,
        "snapshot_jpeg": photo_text(),
        "location": {"lat": 19.85, "lon": 75.25, "accuracy_m": accuracy},
    }
    raw = json.dumps(body).encode()  # json.dumps writes Infinity, which the schema must refuse
    headers = device.headers("POST", PUNCH, raw) | {"Content-Type": "application/json"}

    response = db_client.post(PUNCH, content=raw, headers=headers)

    assert response.status_code == 422
    assert punch_rows(db_session) == []


def test_a_progressive_jpeg_is_refused_before_it_is_decoded(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    import base64

    buffer = io.BytesIO()
    Image.new("RGB", (320, 240), (120, 130, 140)).save(buffer, format="JPEG", progressive=True)
    photo = base64.b64encode(buffer.getvalue()).decode()

    answer = send(db_client, device, worker.qr_text, snapshot=photo).json()

    assert answer["reason_code"] == "SNAPSHOT_INVALID"
    assert snapshot_rows(db_session) == []


def test_a_card_text_in_a_report_is_cut_out_before_it_is_logged(
    db_client: TestClient,
    device: Device,
    kiosk: KioskDevice,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sneaky = "failed on UPS1.A.C000123.ABCDEFGH then\nfake log line‮"

    with caplog.at_level(logging.WARNING):
        response = report(db_client, device, message=sneaky)

    assert response.status_code == 204
    record = next(r for r in caplog.records if r.getMessage() == "kiosk report")
    message = record.fields["message"]  # type: ignore[attr-defined]
    assert "UPS1" not in message and "C000123" not in message
    assert "\n" not in message and "‮" not in message
    assert message.startswith("failed on [card]")
