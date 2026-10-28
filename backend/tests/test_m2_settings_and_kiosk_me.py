"""The M2 settings (editable, ranges, effect), shorter retention for stored photos, and the
kiosk heartbeat with notices and screen settings (spec M2 §5.2, §7 rules 4, 11, 12; AC-25,
AC-31)."""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.kiosks.models import KioskDevice
from app.modules.notices.models import KioskNotice
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role, User
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant

SETTINGS = "/api/v1/settings"
ME = "/api/v1/kiosk/me"

M2_SETTINGS = {
    "punch_cooldown_minutes": 2,
    "snapshot_retention_days": 60,
    "min_minutes_before_out": 30,
    "open_in_max_hours": 20,
    "snapshot_dark_threshold": 40,
    "qr_card_default_validity_months": 2,
    "qr_card_expiring_soon_days": 14,
    "kiosk_voice_enabled": "on",
    "kiosk_sound_enabled": "on",
    "kiosk_result_seconds": 4,
    "kiosk_reject_seconds": 6,
    "kiosk_photo_ready_seconds": 20,
}


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


def listed(client: TestClient) -> dict[str, dict]:
    return {item["key"]: item for item in client.get(SETTINGS).json()["settings"]}


def change(client: TestClient, **values: object):
    return client.put(SETTINGS, json={"values": values, "reason": "test"})


# --- The settings themselves ------------------------------------------------------------------


def test_the_eleven_m2_settings_are_editable_with_their_defaults(boss: TestClient) -> None:
    settings = listed(boss)

    for key, default in M2_SETTINGS.items():
        assert settings[key]["value"] == default, key
        assert settings[key]["editable"] is True, key


def test_settings_of_later_milestones_stay_locked(boss: TestClient) -> None:
    settings = listed(boss)

    assert settings["salary_day_basis"]["editable"] is False  # M7
    assert settings["impossible_travel_kmh"]["editable"] is True  # used from M4
    assert change(boss, salary_day_basis=26).json()["error"]["code"] == ("SETTING_NOT_EDITABLE_YET")


@pytest.mark.parametrize(
    ("key", "low", "high"),
    [
        ("punch_cooldown_minutes", 1, 30),
        ("snapshot_retention_days", 7, 365),
        ("min_minutes_before_out", 2, 240),
        ("open_in_max_hours", 12, 24),
        ("snapshot_dark_threshold", 10, 120),
        ("qr_card_default_validity_months", 1, 36),
        ("qr_card_expiring_soon_days", 1, 60),
        ("kiosk_result_seconds", 2, 10),
        ("kiosk_reject_seconds", 3, 15),
        ("kiosk_photo_ready_seconds", 5, 60),
    ],
)
def test_each_number_accepts_its_edges_and_refuses_values_just_outside(
    boss: TestClient, key: str, low: int, high: int
) -> None:
    assert change(boss, **{key: low}).status_code == 200
    assert change(boss, **{key: high}).status_code == 200
    for outside in (low - 1, high + 1):
        refused = change(boss, **{key: outside})
        assert refused.json()["error"]["code"] == "SETTING_OUT_OF_RANGE"


@pytest.mark.parametrize("key", ["kiosk_voice_enabled", "kiosk_sound_enabled"])
def test_voice_and_sound_switches_take_only_on_or_off(boss: TestClient, key: str) -> None:
    assert change(boss, **{key: "off"}).status_code == 200
    assert listed(boss)[key]["value"] == "off"
    assert change(boss, **{key: "maybe"}).json()["error"]["code"] == "SETTING_OUT_OF_RANGE"
    assert change(boss, **{key: True}).json()["error"]["code"] == "SETTING_OUT_OF_RANGE"


# --- A setting changes the rules --------------------------------------------------------------


def worker_with_in_punch(
    boss: TestClient, db_session: Session, plant: PlantIds, age: timedelta
) -> tuple[KioskDevice, Device, str]:
    from app.core.config import get_settings
    from app.modules.qr_cards.payload import build_payload
    from tests.people_helpers import temporary_body

    device = Device()
    kiosk = make_active_kiosk(db_session, plant, device)
    employee = boss.post("/api/v1/employees", json=temporary_body(plant)).json()
    card = boss.post(f"/api/v1/employees/{employee['id']}/qr-cards", json={}).json()["card"]
    db_session.add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=uuid.UUID(employee["id"]),
            qr_credential_id=uuid.UUID(card["id"]),
            method="qr",
            direction="in",
            decision="accepted",
            reason_codes=[],
            server_received_at=utc_now() - age,
        )
    )
    db_session.commit()
    return kiosk, device, build_payload(get_settings(), card["serial"])


def scan(client: TestClient, device: Device, qr_text: str) -> dict:
    from tests.test_punch_api import send

    return send(client, device, qr_text).json()


def test_a_longer_cool_down_changes_the_answer_for_a_scan_three_minutes_later(
    boss: TestClient, db_client: TestClient, db_session: Session, k134: PlantIds
) -> None:
    _, device, qr_text = worker_with_in_punch(boss, db_session, k134, timedelta(minutes=3))
    assert scan(db_client, device, qr_text)["reason_code"] == "OUT_TOO_SOON"

    change(boss, punch_cooldown_minutes=5)

    assert scan(db_client, device, qr_text)["reason_code"] == "COOLDOWN_ACTIVE"


def test_a_shorter_minimum_gap_lets_an_early_out_through(
    boss: TestClient, db_client: TestClient, db_session: Session, k134: PlantIds
) -> None:
    _, device, qr_text = worker_with_in_punch(boss, db_session, k134, timedelta(minutes=10))
    assert scan(db_client, device, qr_text)["reason_code"] == "OUT_TOO_SOON"

    change(boss, min_minutes_before_out=5)

    assert scan(db_client, device, qr_text)["direction"] == "out"


def test_a_shorter_open_in_limit_turns_a_long_gap_into_a_new_in(
    boss: TestClient, db_client: TestClient, db_session: Session, k134: PlantIds
) -> None:
    _, device, qr_text = worker_with_in_punch(boss, db_session, k134, timedelta(hours=15))
    change(boss, open_in_max_hours=12)

    assert scan(db_client, device, qr_text)["direction"] == "in"


# --- Retention --------------------------------------------------------------------------------


def add_snapshot(
    session: Session, punch: Punch, taken_days_ago: int, expires_in_days: int, state: str
) -> PunchSnapshot:
    now = utc_now()
    snapshot = PunchSnapshot(
        punch_id=punch.id,
        storage_key=f"snapshots/{punch.id}.bin",
        size_bytes=1000,
        width=320,
        height=240,
        brightness=100,
        is_dark=False,
        taken_at=now - timedelta(days=taken_days_ago),
        expires_at=now + timedelta(days=expires_in_days),
        state=state,
        purged_at=now if state == "purged" else None,
    )
    session.add(snapshot)
    session.commit()
    return snapshot


def test_lowering_the_retention_shortens_stored_photos_and_raising_it_does_not(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    kiosk, _, _ = worker_with_in_punch(boss, db_session, k134, timedelta(days=1))
    punches = [
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            method="qr",
            decision="rejected",
            reason_codes=["QR_FORMAT_INVALID"],
            server_received_at=utc_now(),
        )
        for _ in range(3)
    ]
    db_session.add_all(punches)
    db_session.commit()
    old = add_snapshot(
        db_session, punches[0], taken_days_ago=30, expires_in_days=30, state="stored"
    )
    recent = add_snapshot(
        db_session, punches[1], taken_days_ago=2, expires_in_days=58, state="stored"
    )
    purged = add_snapshot(
        db_session, punches[2], taken_days_ago=50, expires_in_days=10, state="purged"
    )
    recent_expiry = recent.expires_at

    change(boss, snapshot_retention_days=7)

    for row in (old, recent, purged):
        db_session.refresh(row)
    assert old.expires_at == old.taken_at + timedelta(days=7)  # already past: due for the purge
    assert recent.expires_at == recent.taken_at + timedelta(days=7)
    assert purged.expires_at != purged.taken_at + timedelta(days=7)  # purged rows are left alone

    change(boss, snapshot_retention_days=120)
    db_session.refresh(recent)
    assert recent.expires_at == recent.taken_at + timedelta(days=7)
    assert recent.expires_at < recent_expiry


def test_new_photos_use_the_current_retention(
    boss: TestClient, db_client: TestClient, db_session: Session, k134: PlantIds
) -> None:
    _, device, qr_text = worker_with_in_punch(boss, db_session, k134, timedelta(hours=9))
    change(boss, snapshot_retention_days=30)

    scan(db_client, device, qr_text)

    snapshot = db_session.query(PunchSnapshot).one()
    assert snapshot.expires_at - snapshot.taken_at == timedelta(days=30)


# --- The kiosk heartbeat ----------------------------------------------------------------------


@pytest.fixture
def device() -> Device:
    return Device()


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds, device: Device) -> KioskDevice:
    return make_active_kiosk(db_session, k134, device)


@pytest.fixture
def author(db_session: Session) -> User:
    from tests.factories import make_user

    return make_user(db_session, Role.SUPER_ADMIN, username="writer")


def notice(
    session: Session,
    author: User,
    plant: PlantIds | None,
    text: str,
    *,
    starts: timedelta = timedelta(hours=-1),
    ends: timedelta = timedelta(hours=5),
    level: str = "normal",
    ended: bool = False,
) -> KioskNotice:
    now = utc_now()
    row = KioskNotice(
        plant_id=uuid.UUID(plant.id) if plant else None,
        text=text,
        level=level,
        starts_at=now + starts,
        ends_at=now + ends,
        created_by=author.id,
        ended_at=now if ended else None,
        ended_by=author.id if ended else None,
    )
    session.add(row)
    session.commit()
    return row


def heartbeat(client: TestClient, device: Device) -> dict:
    response = client.get(ME, headers=device.headers("GET", ME))
    assert response.status_code == 200, response.text
    return response.json()


def test_the_heartbeat_keeps_the_old_fields_and_adds_settings(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    answer = heartbeat(db_client, device)

    assert answer["status"] == "active" and answer["plant"]["code"] == "K134"
    assert answer["notices"] == []
    # M4 adds the location limits and the fence (tested in test_m4_location_and_flags.py).
    assert answer["kiosk_settings"].pop("location")["accuracy_limit_m"] == 50
    offline = answer["kiosk_settings"].pop("offline")
    assert offline["enabled"] is True and len(offline["evidence_public_key"]) == 87  # 65 bytes
    assert offline["max_items"] == 2000 and offline["sync_max_items"] == 20
    assert answer.pop("time_anchor")["token"]  # M4: every signed answer carries one
    assert answer["kiosk_settings"] == {
        "voice_enabled": True,
        "sound_enabled": True,
        "result_seconds": 4,
        "reject_seconds": 6,
        "photo_ready_seconds": 20,
        "snapshot_retention_days": 60,
        "dark_threshold": 40,
        # M3: the gate shows "Punch with face" only when someone here is enrolled.
        "face": {
            "available": True,
            "state": "ready",
            "enabled_for_plant": False,
            "challenge_seconds": 10,
            "code_entry_seconds": 90,
            "min_yaw_degrees": 18,
            "code_prefixes": [],
        },
    }


def test_the_heartbeat_follows_the_settings_and_the_kiosks_own_mute_switch(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    change(boss, kiosk_voice_enabled="off", kiosk_result_seconds=7, snapshot_dark_threshold=60)

    answer = heartbeat(db_client, device)["kiosk_settings"]
    assert answer["voice_enabled"] is False and answer["sound_enabled"] is True
    assert answer["result_seconds"] == 7 and answer["dark_threshold"] == 60

    kiosk.sound_muted = True
    db_session.commit()
    muted = heartbeat(db_client, device)["kiosk_settings"]
    assert muted["voice_enabled"] is False and muted["sound_enabled"] is False


def test_a_notice_shows_for_its_plant_and_for_all_plants_but_not_for_another_plant(
    db_client: TestClient,
    db_session: Session,
    author: User,
    tp1: PlantIds,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    notice(db_session, author, k134, "For K134")
    notice(db_session, author, None, "For everyone")
    notice(db_session, author, tp1, "For TP1 only")

    texts = {item["text"] for item in heartbeat(db_client, device)["notices"]}

    assert texts == {"For K134", "For everyone"}


def test_notices_outside_their_time_or_ended_by_hand_are_hidden(
    db_client: TestClient,
    db_session: Session,
    author: User,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    notice(db_session, author, k134, "Tomorrow", starts=timedelta(hours=2), ends=timedelta(hours=9))
    notice(
        db_session, author, k134, "Yesterday", starts=timedelta(days=-2), ends=timedelta(days=-1)
    )
    notice(db_session, author, k134, "Ended by hand", ended=True)
    notice(db_session, author, k134, "Showing now")

    assert [n["text"] for n in heartbeat(db_client, device)["notices"]] == ["Showing now"]


def test_at_most_three_notices_important_first_then_the_newest(
    db_client: TestClient,
    db_session: Session,
    author: User,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    notice(db_session, author, k134, "Old normal", starts=timedelta(hours=-5))
    notice(db_session, author, k134, "Old important", starts=timedelta(hours=-4), level="important")
    notice(db_session, author, k134, "Newer normal", starts=timedelta(hours=-2))
    notice(db_session, author, k134, "Newest normal", starts=timedelta(minutes=-10))

    answer = heartbeat(db_client, device)["notices"]

    assert [n["text"] for n in answer] == ["Old important", "Newest normal", "Newer normal"]
    assert answer[0]["level"] == "important" and "ends_at" in answer[0]
