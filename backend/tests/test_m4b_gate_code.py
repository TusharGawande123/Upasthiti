"""The changing phone code on the gate screen and the gate-code punch (M4b spec §5.3, §5.4, §7
rules 11, 15; AC-30 to AC-35, AC-42). Real PostgreSQL. Every time is pinned (time-machine) to
Monday 02/11/2026 07:00 IST, as in the spec. Q-301 is a temporary QR worker."""

import base64
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import SnapshotDecryptionError, decode_key, decrypt_snapshot
from app.core.storage import get_storage
from app.modules.audit.models import AuditLog
from app.modules.org.models import Geofence
from app.modules.phone.gate_code import (
    GRACE_SECONDS,
    build_gate_code,
    is_too_early_or_late,
    mac_is_valid,
    parse_gate_code,
)
from app.modules.phone.gate_code_service import reset_eligibility_cache
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import TEST_ORIGIN, clear_cached_settings
from tests.face_helpers import set_privacy
from tests.image_helpers import make_jpeg
from tests.kiosk_helpers import GATE_LOCATION, Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body
from tests.phone_api_helpers import (
    FAR_AWAY,
    PHONE,
    People,
    card_proof,
    make_people,
    signed_in_phone,
    switch_phone,
)

MONDAY = date(2026, 11, 2)
CODE_PATH = "/api/v1/kiosk/gate-code"
SEVEN = ist(MONDAY, 7, 0)


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
def demo1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "DEMO1")


@pytest.fixture
def people(boss: TestClient, db_session: Session, demo1: PlantIds) -> People:
    found = make_people(boss, db_session, demo1)
    switch_phone(boss, found.qr_id)
    return found


@pytest.fixture
def g1(db_session: Session, demo1: PlantIds) -> Device:
    device = Device()
    make_active_kiosk(db_session, demo1, device, name="G1")
    return device


@pytest.fixture
def gate(db_app: FastAPI) -> TestClient:
    return TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})


@pytest.fixture
def worker_phone(db_app: FastAPI, db_session: Session, people: People) -> TestClient:
    return signed_in_phone(db_app, db_session, people.qr_id, "Q-301")


def ask_code(gate: TestClient, device: Device, method: str = "POST"):
    headers = device.headers(method, CODE_PATH, b"")
    return gate.request(method, CODE_PATH, headers=headers)


def selfie() -> str:
    return base64.b64encode(make_jpeg()).decode()


def send_code(
    phone: TestClient,
    code: str,
    *,
    location: dict | None = GATE_LOCATION,
    photo: str | None = "default",
    client_punch_id: str | None = None,
):
    return phone.post(
        f"{PHONE}/punch/gate-code",
        json={
            "client_punch_id": client_punch_id or str(uuid.uuid4()),
            "gate_code": code,
            "photo_jpeg": selfie() if photo == "default" else photo,
            "location": location,
        },
    )


def punches(session: Session) -> list[Punch]:
    session.expire_all()
    return list(session.scalars(select(Punch).order_by(Punch.server_received_at)))


def second_worker(
    boss: TestClient, db_app: FastAPI, db_session: Session, plant: PlantIds
) -> TestClient:
    body = temporary_body(plant) | {"employee_code": "Q-302", "full_name": "Anil Shinde"}
    created = boss.post("/api/v1/employees", json=body)
    assert created.status_code == 201, created.text
    employee_id = created.json()["id"]
    boss.post(f"/api/v1/employees/{employee_id}/qr-cards", json={})
    switch_phone(boss, employee_id)
    return signed_in_phone(db_app, db_session, employee_id, "Q-302")


# --- The code itself: text, signature, life (unit) ---


def test_the_code_text_is_capitals_digits_and_dots_and_has_a_fixed_shape() -> None:
    device_id = uuid.UUID("12345678-1234-5678-1234-567812345678")
    issued_at = datetime(2026, 11, 1, 20, 0, tzinfo=UTC)
    text = build_gate_code(device_id, issued_at)

    parts = text.split(".")
    assert (
        parts[0] == "UPG1" and len(parts[1]) == 26 and len(parts[2]) == 10 and len(parts[3]) == 26
    )
    assert all(character.isupper() or character.isdigit() or character == "." for character in text)
    parsed = parse_gate_code(text)
    assert parsed is not None and parsed.device_id == device_id and mac_is_valid(parsed)
    assert parsed.issued_at == issued_at


@pytest.mark.parametrize(
    "text",
    [
        "",
        "UPG1.",
        "UPS1.A.B.C",
        "upg1.AAAAAAAAAAAAAAAAAAAAAAAAAA.1793590800.AAAAAAAAAAAAAAAAAAAAAAAAAA",
    ],
)
def test_a_text_of_the_wrong_shape_is_not_a_code(text: str) -> None:
    assert parse_gate_code(text) is None


def test_a_changed_letter_breaks_the_signature() -> None:
    text = build_gate_code(uuid.uuid4(), SEVEN)
    mac_part = text.rsplit(".", 1)[1]
    flipped = mac_part[:-1] + ("A" if mac_part[-1] != "A" else "B")
    parsed = parse_gate_code(text.rsplit(".", 1)[0] + "." + flipped)
    assert parsed is not None and not mac_is_valid(parsed)


def test_the_life_is_the_setting_plus_five_seconds_of_grace() -> None:
    parsed = parse_gate_code(build_gate_code(uuid.uuid4(), SEVEN))
    assert parsed is not None
    assert GRACE_SECONDS == 5
    assert not is_too_early_or_late(parsed, SEVEN + timedelta(seconds=35), 30)
    assert is_too_early_or_late(parsed, SEVEN + timedelta(seconds=36), 30)
    assert not is_too_early_or_late(parsed, SEVEN - timedelta(seconds=5), 30)
    assert is_too_early_or_late(parsed, SEVEN - timedelta(seconds=6), 30)


# --- AC-30: the gate asks for a code ---


def test_ac_30_the_gate_gets_a_code_with_a_picture_only_when_someone_could_use_it(
    boss: TestClient, gate: TestClient, g1: Device, people: People
) -> None:
    with frozen_at(SEVEN):
        got = ask_code(gate, g1)
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["code_text"].startswith("UPG1.") and body["svg"].startswith("<svg")
        assert body["refresh_in_seconds"] == 20  # life 30 s - 10 s
        assert body["expires_at"] > body["issued_at"]
        assert ask_code(gate, g1, "GET").json()["code_text"].startswith("UPG1.")  # same answer

        switch_phone(boss, people.qr_id, on=False)
        reset_eligibility_cache()
        assert ask_code(gate, g1).json()["code_text"] is None

        switch_phone(boss, people.qr_id)
        reset_eligibility_cache()
        assert ask_code(gate, g1).json()["code_text"] is not None
        boss.put(
            "/api/v1/settings",
            json={"values": {"kiosk_show_phone_code": "off"}, "reason": "Test change"},
        )
        assert ask_code(gate, g1).json()["code_text"] is None


def test_the_gate_asks_at_most_six_times_a_minute_and_only_when_signed(
    gate: TestClient, g1: Device
) -> None:
    with frozen_at(SEVEN):
        answers = [ask_code(gate, g1).status_code for _ in range(7)]
    assert answers[:6] == [200] * 6 and answers[6] == 429
    stranger = TestClient(gate.app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})
    assert stranger.post(CODE_PATH).status_code == 401


def test_the_gate_me_answer_carries_the_phone_code_settings(gate: TestClient, g1: Device) -> None:
    headers = g1.headers("GET", "/api/v1/kiosk/me", b"")
    body = gate.get("/api/v1/kiosk/me", headers=headers).json()

    assert body["kiosk_settings"]["phone_code"] == {
        "enabled": True,
        "refresh_seconds": 20,
        "show_seconds": 60,
    }


# --- AC-31: a good punch, then a late one ---


def test_ac_31_a_fresh_code_punches_with_an_encrypted_selfie_and_an_old_one_is_expired(
    boss: TestClient,
    db_app: FastAPI,
    db_session: Session,
    gate: TestClient,
    g1: Device,
    people: People,
    demo1: PlantIds,
    worker_phone: TestClient,
) -> None:
    other = second_worker(boss, db_app, db_session, demo1)
    with frozen_at(SEVEN) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=34))
        accepted = send_code(worker_phone, code)
        clock.shift(timedelta(seconds=2))
        late = send_code(other, code)

    body = accepted.json()
    assert (body["decision"], body["direction"], body["reason_code"]) == ("accepted", "in", None)
    assert late.json()["reason_code"] == "GATE_CODE_EXPIRED"
    first, second = punches(db_session)
    assert (first.channel, first.method, str(first.kiosk_id)) == ("phone", "gate_code", g1.kiosk_id)
    assert str(first.employee_id) == people.qr_id and first.qr_credential_id is None
    assert first.location_plant_id == first.plant_id and first.match_mode is None
    assert second.decision == "rejected" and second.employee_id is not None  # named on every row
    snapshot = db_session.scalars(
        select(PunchSnapshot).where(PunchSnapshot.punch_id == first.id)
    ).one()
    assert snapshot.reason == "phone_gate_code" and snapshot.state == "stored"
    stored = get_storage().read(snapshot.storage_key)
    key = decode_key(get_settings().snapshot_encryption_key.get_secret_value())  # type: ignore[union-attr]
    assert stored[:2] != b"\xff\xd8" and decrypt_snapshot(stored, first.id, key)
    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(stored, uuid.uuid4(), key)  # the punch id is bound in
    gate_device = first.kiosk_id
    assert gate_device is not None


def test_one_worker_cannot_use_the_same_code_twice_and_a_retry_gets_the_stored_answer(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient, people: People
) -> None:
    same = str(uuid.uuid4())
    with frozen_at(SEVEN) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        first = send_code(worker_phone, code, client_punch_id=same)
        again = send_code(worker_phone, code, client_punch_id=same)
        clock.shift(timedelta(seconds=10))
        second = send_code(worker_phone, code)

    assert first.json() == again.json() and first.json()["decision"] == "accepted"
    assert second.json()["reason_code"] == "COOLDOWN_ACTIVE"
    assert len(punches(db_session)) == 2


def test_the_gate_device_is_marked_as_having_seen_a_punch(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    from app.modules.kiosks.models import KioskDevice

    with frozen_at(SEVEN):
        code = ask_code(gate, g1).json()["code_text"]
        send_code(worker_phone, code)

    db_session.expire_all()
    kiosk = db_session.get(KioskDevice, uuid.UUID(g1.kiosk_id))
    assert kiosk is not None and kiosk.last_punch_at is not None


# --- AC-32: forged, other plant, revoked ---


def test_ac_32_a_forged_code_a_code_of_another_plant_and_a_revoked_device(
    boss: TestClient,
    db_session: Session,
    gate: TestClient,
    g1: Device,
    worker_phone: TestClient,
    people: People,
) -> None:
    demo2 = create_plant(boss, db_session, "DEMO2")
    db_session.add(
        Geofence(
            plant_id=uuid.UUID(demo2.id),
            version=1,
            shape="circle",
            geojson={"type": "Point", "coordinates": [75.3, 19.9]},
            radius_m=200,
            buffer_m=25,
            is_current=True,
        )
    )
    db_session.commit()
    g2 = Device()
    make_active_kiosk(db_session, demo2, g2, name="G2")
    switch_phone(boss, people.qr_id)
    with frozen_at(SEVEN) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        mac = code.rsplit(".", 1)[1]
        forged = code.rsplit(".", 1)[0] + "." + mac[:-1] + ("A" if mac[-1] != "A" else "B")
        # DEMO2's gate shows a code only when DEMO2 has a worker with phone punching: ask anyway
        # with a hand-made one (the same signing as the server's, for the other device).
        other_plants_code = build_gate_code(uuid.UUID(g2.kiosk_id), SEVEN)
        clock.shift(timedelta(seconds=1))
        assert send_code(worker_phone, forged).json()["reason_code"] == "GATE_CODE_INVALID"
        clock.shift(timedelta(minutes=3))  # past the cool-down of a refused punch? none counted
        wrong = send_code(worker_phone, other_plants_code)
        late_in_life = send_code(worker_phone, code)  # 3 minutes old: expired
        assert late_in_life.json()["reason_code"] == "GATE_CODE_EXPIRED"
    assert wrong.json()["reason_code"] == "GATE_CODE_EXPIRED"  # also 3 minutes old

    with frozen_at(SEVEN + timedelta(minutes=10)):
        fresh_other = build_gate_code(uuid.UUID(g2.kiosk_id), SEVEN + timedelta(minutes=10))
        assert send_code(worker_phone, fresh_other).json()["reason_code"] == "WRONG_PLANT"
        fresh_own = ask_code(gate, g1).json()["code_text"]
        revoked = boss.post(f"/api/v1/kiosks/{g1.kiosk_id}/revoke", json={"reason": "Device lost"})
        assert revoked.status_code == 200, revoked.text
        assert send_code(worker_phone, fresh_own).json()["reason_code"] == "GATE_CODE_INVALID"

    codes = [row.reason_codes[0] for row in punches(db_session)]
    assert codes == [
        "GATE_CODE_INVALID",
        "GATE_CODE_EXPIRED",
        "GATE_CODE_EXPIRED",
        "WRONG_PLANT",
        "GATE_CODE_INVALID",
    ]


def test_a_text_that_names_no_known_device_is_refused_and_nothing_is_stored(
    db_session: Session, worker_phone: TestClient
) -> None:
    with frozen_at(SEVEN):
        unknown = build_gate_code(uuid.uuid4(), SEVEN)
        answer = send_code(worker_phone, unknown)
        rubbish = send_code(worker_phone, "hello")

    for result in (answer, rubbish):
        assert result.status_code == 200
        assert result.json()["reason_code"] == "GATE_CODE_INVALID"
        assert result.json()["punch_id"] is None
    assert punches(db_session) == []


# --- AC-33: a photographed code, sent from home ---


def test_ac_33_a_code_sent_from_far_away_is_refused_and_the_selfie_is_kept(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    with frozen_at(SEVEN):
        code = ask_code(gate, g1).json()["code_text"]
        answer = send_code(worker_phone, code, location=FAR_AWAY | {"accuracy_m": 10.0})

    assert answer.json()["reason_code"] == "OUTSIDE_GEOFENCE"
    (row,) = punches(db_session)
    assert row.decision == "rejected" and row.employee_id is not None
    assert db_session.scalars(select(PunchSnapshot)).one().punch_id == row.id


@pytest.mark.parametrize(
    ("location", "photo", "code"),
    [
        (None, "default", "LOCATION_REQUIRED"),
        (GATE_LOCATION, None, "SNAPSHOT_MISSING"),
        (GATE_LOCATION, base64.b64encode(b"not a picture").decode(), "SNAPSHOT_INVALID"),
        (GATE_LOCATION | {"accuracy_m": 90.0}, "default", "GPS_ACCURACY_TOO_LOW"),
    ],
)
def test_location_and_selfie_problems_are_decided_refusals(
    db_session: Session,
    gate: TestClient,
    g1: Device,
    worker_phone: TestClient,
    location: dict | None,
    photo: str | None,
    code: str,
) -> None:
    with frozen_at(SEVEN):
        text = ask_code(gate, g1).json()["code_text"]
        answer = send_code(worker_phone, text, location=location, photo=photo)

    assert answer.json()["reason_code"] == code
    assert punches(db_session)[0].decision == "rejected"


# --- AC-34: no ID card is needed ---


def test_ac_34_a_revoked_card_does_not_stop_a_phone_punch_but_stops_a_card_proof(
    boss: TestClient,
    db_session: Session,
    gate: TestClient,
    g1: Device,
    worker_phone: TestClient,
    people: People,
    db_app: FastAPI,
) -> None:
    revoked = boss.post(
        f"/api/v1/qr-cards/{people.card_id}/revoke", json={"kind": "lost", "reason": "Lost it"}
    )
    assert revoked.status_code == 200, revoked.text
    with frozen_at(SEVEN):
        code = ask_code(gate, g1).json()["code_text"]
        answer = send_code(worker_phone, code)
        assert answer.json()["decision"] == "accepted"
        from tests.phone_api_helpers import phone_client

        proof = card_proof(phone_client(db_app), people.card_text)
        assert proof.status_code == 401 and proof.json()["error"]["code"] == "PROOF_FAILED"

    (row,) = punches(db_session)
    assert row.qr_credential_id is None


# --- AC-35 (the gate-code side) and the checks of the request ---


def test_the_request_checks_come_first_and_write_no_row(
    db_app: FastAPI,
    db_session: Session,
    people: People,
    gate: TestClient,
    g1: Device,
) -> None:
    no_notice = signed_in_phone(db_app, db_session, people.qr_id, "Q-301", notice=False)

    refused = send_code(no_notice, "UPG1.X")

    assert refused.status_code == 428
    assert refused.json()["error"]["code"] == "PHONE_NOTICE_REQUIRED"
    assert punches(db_session) == []


def test_ten_gate_code_punches_a_minute_then_too_many_requests(
    worker_phone: TestClient,
) -> None:
    with frozen_at(SEVEN):
        answers = [send_code(worker_phone, "hello").status_code for _ in range(11)]

    assert answers[:10] == [200] * 10 and answers[10] == 429


# --- AC-42: the cool-down cross-check ---


def test_ac_42_the_phone_code_must_change_faster_than_the_cooldown(
    boss: TestClient, db_session: Session
) -> None:
    refused = boss.put(
        "/api/v1/settings",
        json={
            "values": {"phone_gate_code_seconds": 60, "punch_cooldown_minutes": 1},
            "reason": "Test change",
        },
    )

    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "SETTING_INVALID"
    ok = boss.put(
        "/api/v1/settings",
        json={
            "values": {"phone_gate_code_seconds": 45, "punch_cooldown_minutes": 1},
            "reason": "Test change",
        },
    )
    assert ok.status_code == 200, ok.text  # 45 + 5 = 50 s is shorter than 60 s
    shorter_cooldown = boss.put(
        "/api/v1/settings", json={"values": {"punch_cooldown_minutes": 1}, "reason": "Test change"}
    )
    assert shorter_cooldown.status_code == 200
    longer_code = boss.put(
        "/api/v1/settings",
        json={"values": {"phone_gate_code_seconds": 56}, "reason": "Test change"},
    )
    assert longer_code.status_code == 422  # 56 + 5 = 61 s is not shorter than 60 s
    assert db_session.scalars(select(AuditLog).where(AuditLog.action == "settings.update")).all()


def test_the_code_text_is_the_only_new_secret_and_needs_no_new_setting_in_the_environment() -> None:
    """The key comes from APP_SECRET_KEY (rule 15): the same text is made from the same secret."""
    device_id = uuid.uuid4()
    assert build_gate_code(device_id, SEVEN) == build_gate_code(device_id, SEVEN)
    assert json.dumps(sorted(get_settings().model_dump().keys())).count("gate") == 0


# --- Review fixes: a selfie without a face, and a code that names no device ---------------------


def test_a_phone_selfie_without_a_face_tells_the_super_admin_and_is_in_the_digest(
    boss: TestClient,
    db_session: Session,
    gate: TestClient,
    g1: Device,
    worker_phone: TestClient,
) -> None:
    from app.modules.notifications.models import Notification
    from app.modules.phone.selfie_alert import note_selfie_without_face

    with frozen_at(SEVEN) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=10))
        accepted = send_code(worker_phone, code)
        assert accepted.json()["decision"] == "accepted"  # the decision never changes
        snapshot = db_session.scalars(select(PunchSnapshot)).one()
        snapshot.face_found = False
        note_selfie_without_face(db_session, snapshot, SEVEN)
        db_session.commit()

        notice = db_session.scalars(
            select(Notification).where(Notification.kind == "phone_selfie_no_face")
        ).one()
        assert notice.params["count"] == 1 and notice.plant_id is not None
        assert "Q-301" not in str(notice.params) and "Ramesh" not in str(notice.params)
        listed = boss.get("/api/v1/notifications").json()["items"]
        assert [item["kind"] for item in listed] == ["phone_selfie_no_face"]
        digest = boss.get("/api/v1/reviews/digest", params={"date": MONDAY.isoformat()}).json()
        assert sum(plant["phone_selfie_no_face"] for plant in digest["plants"]) == 1


def test_a_code_naming_an_unknown_device_leaves_an_audit_row_with_a_hash_only(
    db_session: Session, worker_phone: TestClient, people: People
) -> None:
    import hashlib

    with frozen_at(SEVEN):
        unknown = build_gate_code(uuid.uuid4(), SEVEN)
        assert send_code(worker_phone, unknown).json()["reason_code"] == "GATE_CODE_INVALID"

    rows = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "phone_punch.gate_code_unknown_device")
    ).all()
    assert len(rows) == 1
    assert str(rows[0].entity_id) == people.qr_id
    assert rows[0].after == {"text_sha256": hashlib.sha256(unknown.encode()).hexdigest()}
    assert unknown not in str(rows[0].after)
