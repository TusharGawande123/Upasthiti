"""The offline sync endpoint (M4 spec §5.2, §7 rules 5, 8, 11; AC-10 to AC-18, AC-34).

A fake gate takes a time anchor, saves sealed punches while "offline" and sends them to
/kiosk/sync. The server must decide every item itself: time, location, card, IN/OUT."""

import json
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice, KioskHeartbeat
from app.modules.org.models import Geofence
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import build_payload
from app.modules.settings.models import SettingValue
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.kiosk_helpers import GATE_FENCE_RADIUS_M, GATE_LOCATION, Device, make_active_kiosk
from tests.offline_helpers import SYNC, OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_m4_location_and_flags import add_counted_punch, north_of_gate
from tests.test_punch_api import Worker, photo_text


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
def worker(boss: TestClient, k134: PlantIds) -> Worker:
    return Worker(boss, k134)


@pytest.fixture
def gate(device: Device, kiosk: KioskDevice) -> OfflineGate:
    """A gate that got its last server time 1 hour ago."""
    fake = OfflineGate(device)
    fake.take_anchor(utc_now() - timedelta(hours=1))
    return fake


def card_item(gate: OfflineGate, worker: Worker, **options):
    return gate.item("qr", card_evidence(worker.qr_text, photo_text()), **options)


def rows(session: Session) -> list[Punch]:
    return list(session.scalars(select(Punch).order_by(Punch.punch_time)))


# --- A good offline card punch (AC-10) -------------------------------------------------------


def test_an_offline_card_punch_is_decided_at_sync_with_its_proven_time(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, elapsed=timedelta(minutes=30))

    response = gate.send(db_client, [item])

    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    assert result["result"] == "saved" and result["decision"] == "accepted"
    assert response.json()["time_anchor"]["token"]
    (punch,) = rows(db_session)
    assert punch.was_offline and punch.time_proof == "anchored"
    assert punch.decision == "accepted" and punch.direction == "in"
    # The punch time is the anchor + 30 minutes, about 30 minutes ago; the row says when it arrived.
    offline_time = punch.offline_punch_time
    assert offline_time is not None
    assert abs((utc_now() - offline_time) - timedelta(minutes=30)) < timedelta(minutes=1)
    assert punch.server_received_at > offline_time
    assert punch.punch_time == punch.offline_punch_time
    assert punch.device_counter == item["counter"]
    snapshot = db_session.scalars(select(PunchSnapshot)).one()
    assert snapshot.punch_id == punch.id  # the card photo is kept, as for an online card punch


def test_a_batch_is_decided_oldest_first_and_alternates_in_and_out(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    later = card_item(gate, worker, elapsed=timedelta(minutes=50))
    earlier = card_item(gate, worker, elapsed=timedelta(minutes=10))

    results = gate.send(db_client, [later, earlier]).json()["results"]

    assert [r["result"] for r in results] == ["saved", "saved"]
    first, second = rows(db_session)
    assert (first.direction, second.direction) == ("in", "out")
    assert first.punch_time < second.punch_time


# --- Same punch twice, replays and edits (AC-11, AC-12, AC-34) ----------------------------------


def test_an_item_that_already_reached_the_server_is_not_made_twice(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker)
    first = gate.send(db_client, [item]).json()["results"][0]

    again = gate.send(db_client, [item]).json()["results"][0]

    assert first["result"] == "saved" and again["result"] == "already_saved"
    assert again["punch_id"] == first["punch_id"] and again["decision"] == "accepted"
    assert len(rows(db_session)) == 1


def test_a_replayed_sync_request_is_refused(
    db_client: TestClient, gate: OfflineGate, worker: Worker
) -> None:
    body = json.dumps({"items": [card_item(gate, worker)], "app_version": "t"}).encode()
    headers = gate.device.headers("POST", SYNC, body) | {"Content-Type": "application/json"}
    assert db_client.post(SYNC, content=body, headers=headers).status_code == 200

    replay = db_client.post(SYNC, content=body, headers=headers)

    assert replay.status_code == 401 and replay.json()["error"]["code"] == "NONCE_REUSED"


def test_an_item_edited_after_signing_is_refused(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, tamper_after_signing=True)

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["result"] == "refused" and result["reason_code"] == "ITEM_SIGNATURE_INVALID"
    assert rows(db_session) == []  # a refused item writes no punch
    refusal = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "kiosk.sync_item_refused")
    ).one()
    assert refusal.after == {"client_punch_id": None, "reason": "ITEM_SIGNATURE_INVALID"}


def test_an_item_signed_by_another_device_is_refused(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    other = Device()
    other.kiosk_id = gate.device.kiosk_id
    forged = OfflineGate(other)
    forged.take_anchor(utc_now() - timedelta(hours=1))
    item = card_item(forged, worker)

    (result,) = gate.send(db_client, [item], counter=other.counter + 50).json()["results"]

    assert result["result"] == "refused" and result["reason_code"] == "ITEM_SIGNATURE_INVALID"


def test_a_resigned_copy_with_a_used_counter_is_refused(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    original = card_item(gate, worker)
    assert gate.send(db_client, [original]).json()["results"][0]["result"] == "saved"
    # The same counter again under a NEW punch id, signed by the real device.
    copy = card_item(gate, worker, counter=original["counter"])

    (result,) = gate.send(db_client, [copy]).json()["results"]

    assert result["result"] == "refused" and result["reason_code"] == "ITEM_COUNTER_INVALID"
    assert len(rows(db_session)) == 1


def test_a_counter_at_or_after_the_sync_request_is_refused(
    db_client: TestClient, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker)

    (result,) = gate.send(db_client, [item], counter=item["counter"]).json()["results"]

    assert result["result"] == "refused" and result["reason_code"] == "ITEM_COUNTER_INVALID"


def test_unreadable_evidence_is_still_recorded_so_a_lost_punch_is_seen(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    # The ciphertext was sealed for another punch id: moving it to this item cannot open it.
    item = card_item(gate, worker, binding_punch_id=uuid.uuid4())

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["result"] == "saved" and result["decision"] == "rejected"
    assert result["reason_code"] == "OFFLINE_EVIDENCE_UNREADABLE"
    (punch,) = rows(db_session)
    assert punch.employee_id is None and punch.was_offline


def test_evidence_sealed_with_an_unknown_key_id_is_unreadable(
    db_client: TestClient, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, key_id="B")

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "OFFLINE_EVIDENCE_UNREADABLE"


# --- The time (AC-14) ---------------------------------------------------------------------------


def test_a_device_that_restarted_offline_gets_an_unproven_flagged_punch(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, same_session=False)

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "accepted"  # a flag counts, it never loses the punch
    (punch,) = rows(db_session)
    assert punch.decision == "flagged" and punch.time_proof == "unproven"
    assert punch.reason_codes == ["OFFLINE_TIME_UNPROVEN"]
    assert punch.direction == "in"


def test_a_changed_device_clock_cannot_move_the_proven_time(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    # The monotonic clock says 30 minutes, the wall clock was moved a day back.
    item = card_item(gate, worker, elapsed=timedelta(minutes=30), wall_elapsed=timedelta(hours=-24))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "unproven" and punch.reason_codes[0] == "OFFLINE_TIME_UNPROVEN"
    assert utc_now() - timedelta(hours=1, minutes=1) <= punch.punch_time <= utc_now()


def test_a_forged_anchor_never_gives_a_proven_time(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, anchor_token="forged-token")

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "unproven"


def test_a_punch_saved_for_more_than_72_hours_is_flagged_too_old(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    # The card was already valid 10 days ago (a new card would not be valid at that time).
    card = db_session.get(QrCredential, worker.card_id)
    assert card is not None
    card.valid_from = (utc_now() - timedelta(days=10)).date()
    db_session.commit()
    old_gate = OfflineGate(gate.device)
    old_gate.take_anchor(utc_now() - timedelta(hours=100))
    item = card_item(old_gate, worker, elapsed=timedelta(hours=5))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "anchored" and "OFFLINE_TOO_OLD" in punch.reason_codes
    assert punch.decision == "flagged"


def test_too_old_follows_the_offline_max_hours_setting(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    """The Super Admin may set 24 to 168 hours (spec §7 rule 17); the flag uses that value."""
    db_session.merge(SettingValue(key="offline_max_hours", value=24))
    db_session.commit()
    card = db_session.get(QrCredential, worker.card_id)
    assert card is not None
    card.valid_from = (utc_now() - timedelta(days=3)).date()
    db_session.commit()
    old_gate = OfflineGate(gate.device)
    old_gate.take_anchor(utc_now() - timedelta(hours=30))
    item = card_item(old_gate, worker, elapsed=timedelta(minutes=1))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "anchored"
    assert "OFFLINE_TOO_OLD" in punch.reason_codes  # 30 h > 24 h, although under the default 72


# --- A device the server heard from cannot claim an old anchor (security review, decision 0029) ---


def heard_from(session: Session, kiosk: KioskDevice, age: timedelta) -> None:
    """A health sample of the device `age` ago: the device was online then."""
    session.add(
        KioskHeartbeat(
            kiosk_id=kiosk.id,
            received_at=utc_now() - age,
            queue_count=0,
            location_state="good",
        )
    )
    session.commit()


def three_hour_old_anchor(gate: OfflineGate) -> OfflineGate:
    old_gate = OfflineGate(gate.device)
    old_gate.take_anchor(utc_now() - timedelta(hours=3))
    return old_gate


def test_a_time_after_the_device_was_heard_again_is_not_proven(
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    """The device reached the server 2 h ago, so it held a newer anchor than the one from 3 h ago.
    Choosing the old one to claim a time 30 minutes ago (after that contact) is its own doing."""
    heard_from(db_session, kiosk, timedelta(hours=2))
    item = card_item(three_hour_old_anchor(gate), worker, elapsed=timedelta(hours=2, minutes=30))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "unproven"
    assert punch.decision == "flagged" and "OFFLINE_TIME_UNPROVEN" in punch.reason_codes


def test_contact_right_after_the_anchor_does_not_spoil_the_proof(
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    """The request that made the anchor and its answer are the same moment: a sample a minute
    after the anchor is that heartbeat, not a later contact."""
    heard_from(db_session, kiosk, timedelta(hours=3) - timedelta(minutes=1))
    item = card_item(three_hour_old_anchor(gate), worker, elapsed=timedelta(hours=2, minutes=30))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "anchored" and punch.decision == "accepted"


def test_contact_after_the_punch_time_keeps_the_proof(
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    """The normal case: offline for hours, a punch made inside that stretch, then the internet
    comes back (a health sample after the punch time). The proof stays."""
    heard_from(db_session, kiosk, timedelta(minutes=30))
    item = card_item(three_hour_old_anchor(gate), worker, elapsed=timedelta(hours=2))

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "anchored" and punch.decision == "accepted"


def test_an_online_punch_after_the_anchor_also_counts_as_contact(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    kiosk: KioskDevice,
    worker: Worker,
    k134: PlantIds,
) -> None:
    other = Worker(boss, k134, "T-9")
    add_counted_punch(db_session, kiosk, other, timedelta(hours=2), decision="accepted")
    item = card_item(three_hour_old_anchor(gate), worker, elapsed=timedelta(hours=2, minutes=30))

    gate.send(db_client, [item])

    punches = [punch for punch in rows(db_session) if punch.employee_id == worker.employee_id]
    assert punches[0].time_proof == "unproven"


def test_an_unproven_time_is_judged_against_todays_fence(
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    worker: Worker,
    kiosk: KioskDevice,
) -> None:
    """A device can choose an unproven time, so it must not be able to pick a moment when an
    older, wider fence version was current (facts_at_time: unproven = judged as at sync)."""
    db_session.add(
        Geofence(
            plant_id=kiosk.plant_id,
            version=0,
            shape="circle",
            geojson={"type": "Point", "coordinates": [GATE_LOCATION["lon"], GATE_LOCATION["lat"]]},
            radius_m=2000,
            buffer_m=25,
            is_current=False,
            created_at=utc_now() - timedelta(days=2),
        )
    )
    db_session.commit()
    outside_today = north_of_gate(GATE_FENCE_RADIUS_M + 300)
    item = card_item(gate, worker, anchor_token="forged-token", location=outside_today)

    gate.send(db_client, [item])

    (punch,) = rows(db_session)
    assert punch.time_proof == "unproven"
    assert punch.decision == "rejected" and punch.reason_codes[0] == "OUTSIDE_GEOFENCE"


# --- Judged as things were then (AC-16) ------------------------------------------------------


def test_a_card_revoked_after_the_punch_time_still_counts_when_the_time_is_proven(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    worker: Worker,
) -> None:
    item = card_item(gate, worker, elapsed=timedelta(minutes=20))  # 40 minutes ago
    boss.post(f"/api/v1/qr-cards/{worker.card_id}/revoke", json={"kind": "lost", "reason": "Lost"})

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "accepted"


def test_the_same_card_revoked_before_the_punch_time_is_refused(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    worker: Worker,
) -> None:
    boss.post(f"/api/v1/qr-cards/{worker.card_id}/revoke", json={"kind": "lost", "reason": "Lost"})
    card = db_session.get(QrCredential, worker.card_id)
    assert card is not None
    card.revoked_at = utc_now() - timedelta(minutes=40)  # revoked before the punch below
    db_session.commit()
    item = card_item(gate, worker, elapsed=timedelta(minutes=50))  # 10 minutes ago

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "rejected" and result["reason_code"] == "QR_REVOKED"


def test_an_unproven_time_is_judged_as_things_are_at_sync_which_is_stricter(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    gate: OfflineGate,
    worker: Worker,
) -> None:
    item = card_item(gate, worker, elapsed=timedelta(minutes=20), same_session=False)
    boss.post(f"/api/v1/qr-cards/{worker.card_id}/revoke", json={"kind": "lost", "reason": "Lost"})

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "QR_REVOKED"


# --- Location on offline punches (AC-3, AC-36) -------------------------------------------------


def test_an_offline_punch_outside_the_fence_is_rejected_like_an_online_one(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, location=north_of_gate(GATE_FENCE_RADIUS_M + 400))

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["reason_code"] == "OUTSIDE_GEOFENCE"


def test_a_reused_old_reading_is_flagged_stale_not_rejected(
    db_client: TestClient, db_session: Session, gate: OfflineGate, worker: Worker
) -> None:
    item = card_item(gate, worker, location=GATE_LOCATION | {"age_s": 3 * 3600})

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "accepted"
    (punch,) = rows(db_session)
    assert punch.decision == "flagged" and punch.reason_codes == ["LOCATION_STALE"]
    assert punch.location_age_s == 3 * 3600


# --- Order against punches already decided (AC-15) ---------------------------------------------


def online_punch(session: Session, kiosk: KioskDevice, worker: Worker, minutes_ago: int) -> Punch:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=worker.employee_id,
        qr_credential_id=worker.card_id,
        method="qr",
        direction="in",
        decision="accepted",
        reason_codes=[],
        server_received_at=utc_now() - timedelta(minutes=minutes_ago),
    )
    session.add(punch)
    session.commit()
    return punch


def test_an_offline_punch_older_than_a_decided_one_is_flagged_for_order(
    db_client: TestClient,
    db_session: Session,
    kiosk: KioskDevice,
    gate: OfflineGate,
    worker: Worker,
) -> None:
    later = online_punch(db_session, kiosk, worker, minutes_ago=10)
    item = card_item(gate, worker, elapsed=timedelta(minutes=10))  # about 50 minutes ago

    gate.send(db_client, [item])

    offline = next(p for p in rows(db_session) if p.was_offline)
    assert offline.decision == "flagged" and offline.reason_codes == ["SYNC_ORDER_CONFLICT"]
    assert offline.related_punch_id == later.id and offline.direction == "in"


def test_an_offline_double_punch_next_to_a_decided_one_is_a_cool_down_rejection(
    db_client: TestClient,
    db_session: Session,
    kiosk: KioskDevice,
    gate: OfflineGate,
    worker: Worker,
) -> None:
    online_punch(db_session, kiosk, worker, minutes_ago=29)
    item = card_item(gate, worker, elapsed=timedelta(minutes=30))  # a minute before it

    (result,) = gate.send(db_client, [item]).json()["results"]

    assert result["decision"] == "rejected" and result["reason_code"] == "COOLDOWN_ACTIVE"


# --- Limits ---------------------------------------------------------------------------------


def test_the_sync_needs_the_offline_key_and_a_signed_request(
    db_client: TestClient, device: Device, kiosk: KioskDevice, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = json.dumps({"items": [{"counter": 1, "signed_item": "{}", "signature": "x" * 20}]})
    unsigned = db_client.post(SYNC, content=body, headers={"Content-Type": "application/json"})
    assert unsigned.status_code == 401

    monkeypatch.setenv("OFFLINE_EVIDENCE_KEY", "")
    clear_cached_settings()
    assert get_settings().offline_evidence_key is None
    headers = device.headers("POST", SYNC, body.encode()) | {"Content-Type": "application/json"}
    missing = db_client.post(SYNC, content=body, headers=headers)
    assert (
        missing.status_code == 503 and missing.json()["error"]["code"] == "OFFLINE_NOT_CONFIGURED"
    )


def test_no_log_line_of_a_sync_holds_the_item_text_or_the_evidence(
    db_client: TestClient,
    gate: OfflineGate,
    worker: Worker,
    caplog: pytest.LogCaptureFixture,
) -> None:
    item = card_item(gate, worker)
    caplog.set_level("DEBUG")

    gate.send(db_client, [item])

    logged = " ".join(
        record.getMessage() + str(getattr(record, "fields", "")) for record in caplog.records
    )
    assert worker.qr_text not in logged
    assert item["signed_item"] not in logged and item["signature"] not in logged
    assert build_payload(get_settings(), worker.serial) not in logged
