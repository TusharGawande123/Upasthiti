"""Attendance device status and health (M4 spec §4.7, §5.2, §5.4, §7 rules 15, 16, 20; FR-24, F-3,
F-36, F-46, AC-20, AC-22, AC-23, AC-37, AC-38, AC-41). The state is worked out when read."""

import json
import uuid
from datetime import UTC, datetime, time, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist, utc_now
from app.jobs.daily import purge_old_heartbeats
from app.modules.kiosks.models import KioskDevice, KioskHeartbeat
from app.modules.kiosks.status import DeviceState, device_state
from app.modules.org.models import Shift, UserPlantAccess
from app.modules.users.models import Role, User
from tests.factories import log_in, make_user
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant

HEARTBEAT = "/api/v1/kiosk/heartbeat"
GOOD = {"state": "good", "lat": 19.85, "lon": 75.25, "accuracy_m": 12.0, "age_s": 3}


def report(**changes: object) -> dict:
    body: dict = {
        "queue": {"count": 0, "bytes": 0},
        "location": GOOD,
        "storage": {"persisted": True, "quota_mb": 5000, "usage_mb": 40, "offline_ready": True},
        "battery": {"level": 0.82, "charging": True},
        "camera_ok": True,
        "app_version": "t1",
    }
    return body | changes


def beat(client: TestClient, device: Device, body: dict):
    raw = json.dumps(body).encode()
    headers = device.headers("POST", HEARTBEAT, raw) | {"Content-Type": "application/json"}
    return client.post(HEARTBEAT, content=raw, headers=headers)


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


def listed(client: TestClient, **params: str) -> list[dict]:
    response = client.get("/api/v1/kiosks", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# --- The heartbeat ----------------------------------------------------------------------------


def test_the_heartbeat_answers_like_kiosk_me_and_stores_what_the_gate_reports(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice
) -> None:
    response = beat(
        db_client,
        device,
        report(queue={"count": 12, "bytes": 3_000_000, "oldest_punch_at": "2026-10-28T08:05:00Z"}),
    )

    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["kiosk_id"] == str(kiosk.id) and answer["time_anchor"]["token"]
    assert answer["kiosk_settings"]["location"]["geofence"]["shape"] == "circle"
    db_session.refresh(kiosk)
    assert kiosk.queue_count == 12 and kiosk.queue_bytes == 3_000_000
    assert kiosk.location_state == "good" and float(kiosk.last_accuracy_m or 0) == 12.0
    assert float(kiosk.battery_level or 0) == 0.82 and kiosk.battery_charging is True
    assert kiosk.camera_ok is True and kiosk.offline_ready is True and kiosk.app_version == "t1"
    assert kiosk.last_heartbeat_at is not None


@pytest.mark.parametrize(
    "bad",
    [
        {"location": {"state": "flying"}},
        {"queue": {"count": -1, "bytes": 0}},
        {"battery": {"level": 1.5, "charging": True}},
        {"location": {"state": "good", "lat": 999.0, "lon": 75.0}},
    ],
)
def test_a_nonsense_heartbeat_is_a_validation_error(
    db_client: TestClient, device: Device, kiosk: KioskDevice, bad: dict
) -> None:
    response = beat(db_client, device, report(**bad))

    assert response.status_code == 422 and response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_heartbeats_are_limited_to_six_a_minute(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    codes = [beat(db_client, device, report()).status_code for _ in range(8)]

    assert codes[:6] == [200] * 6 and codes[6:] == [429, 429]


def test_a_sample_is_kept_at_most_every_5_minutes_or_when_something_changes(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice
) -> None:
    beat(db_client, device, report())
    beat(db_client, device, report())  # same state, seconds later: no new sample
    assert len(db_session.scalars(select(KioskHeartbeat)).all()) == 1

    beat(db_client, device, report(location={"state": "weak", "accuracy_m": 140.0}))

    samples = db_session.scalars(select(KioskHeartbeat).order_by(KioskHeartbeat.received_at)).all()
    assert [s.location_state for s in samples] == ["good", "weak"]  # a change is sampled at once
    assert not hasattr(samples[0], "lat")  # no coordinates in the samples


# --- The state (computed on read) ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({}, DeviceState.ONLINE),
        ({"location_state": "weak"}, DeviceState.NEEDS_LOCATION),
        ({"location_state": "outside"}, DeviceState.NEEDS_LOCATION),
        ({"location_state": "stale"}, DeviceState.ONLINE),  # offline reuse is not a problem
        ({"queue_count": 12}, DeviceState.SENDING),
        ({"last_seen_at": utc_now() - timedelta(minutes=10)}, DeviceState.OFFLINE),
        ({"last_seen_at": None}, DeviceState.OFFLINE),
        ({"status": "revoked"}, DeviceState.REVOKED),
        ({"status": "pending"}, DeviceState.PENDING),
    ],
)
def test_the_state_follows_the_rules_of_the_spec(
    changes: dict, expected: DeviceState, kiosk: KioskDevice
) -> None:
    now = utc_now()
    kiosk.last_seen_at = now - timedelta(seconds=20)
    kiosk.location_state = "good"
    kiosk.queue_count = 0
    for field, value in changes.items():
        setattr(kiosk, field, value)

    assert device_state(kiosk, now, offline_after_minutes=3) is expected


def test_the_devices_list_shows_state_queue_location_and_the_position_to_the_right_roles(
    boss: TestClient,
    db_client: TestClient,
    db_app: FastAPI,
    db_session: Session,
    device: Device,
    k134: PlantIds,
    kiosk: KioskDevice,
) -> None:
    beat(db_client, device, report(queue={"count": 3, "bytes": 900}))

    (row,) = listed(boss)

    assert row["state"] == "sending" and row["queue"]["count"] == 3
    assert row["location"]["inside"] == "inside" and row["location"]["lat"] == 19.85
    assert row["battery"] == {"level": 0.82, "charging": True} and row["camera_ok"] is True
    assert row["storage"]["offline_ready"] is True
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    (seen,) = listed(corporate)
    assert seen["state"] == "sending" and seen["location"]["lat"] is None  # no position for them
    assert seen["location"]["inside"] == "inside"


def test_the_list_can_be_filtered_by_state(
    boss: TestClient, db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    beat(db_client, device, report())

    assert len(listed(boss, state="online")) == 1
    assert listed(boss, state="offline") == []


# --- Badge, dashboard card and the offline alert (F-36, F-46) ----------------------------------


def make_shift_now(session: Session, plant: PlantIds) -> None:
    """One shift that is running right now (IST), so the alert rule can fire."""
    import uuid

    now = to_ist(utc_now())
    for shift in session.scalars(select(Shift).where(Shift.plant_id == uuid.UUID(plant.id))):
        shift.is_active = False
    start_time = (now - timedelta(hours=1)).time().replace(microsecond=0)
    end_time = (now + timedelta(hours=1)).time().replace(microsecond=0)
    session.add(
        Shift(
            plant_id=uuid.UUID(plant.id),
            name="Now",
            start_time=start_time,
            end_time=end_time,
            grace_min=10,
            half_day_min=240,
            ot_after_min=480,
            crosses_midnight=start_time > end_time,  # near midnight the shift wraps
            is_active=True,
        )
    )
    session.commit()


def test_an_offline_device_during_a_shift_raises_the_alert_for_the_right_roles(
    boss: TestClient,
    db_app: FastAPI,
    db_session: Session,
    kiosk: KioskDevice,
    k134: PlantIds,
) -> None:
    make_shift_now(db_session, k134)
    kiosk.last_seen_at = utc_now() - timedelta(minutes=14)
    db_session.commit()

    summary = boss.get("/api/v1/kiosks/status-summary").json()

    assert summary["offline"] == 1 and summary["online"] == 0
    (alert,) = summary["alerts"]
    assert alert["kiosk"]["name"] == "Main gate" and alert["plant"]["code"] == "K134"
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    seen = corporate.get("/api/v1/kiosks/status-summary").json()
    assert seen["offline"] == 1 and seen["alerts"] == []  # the badge, but never the alert


def test_no_alert_before_the_alert_time_or_outside_a_shift(
    boss: TestClient, db_session: Session, kiosk: KioskDevice, k134: PlantIds
) -> None:
    make_shift_now(db_session, k134)
    kiosk.last_seen_at = utc_now() - timedelta(minutes=5)  # offline, but under 10 minutes
    db_session.commit()
    assert boss.get("/api/v1/kiosks/status-summary").json()["alerts"] == []

    shift = db_session.scalars(select(Shift).where(Shift.name == "Now")).one()
    shift.is_active = False
    kiosk.last_seen_at = utc_now() - timedelta(minutes=30)
    db_session.commit()  # no active shift now: nobody is at the gate
    assert boss.get("/api/v1/kiosks/status-summary").json()["alerts"] == []


def test_a_plant_head_sees_the_alert_of_their_own_plant_only(
    boss: TestClient,
    db_app: FastAPI,
    db_session: Session,
    kiosk: KioskDevice,
    k134: PlantIds,
) -> None:
    other = create_plant(boss, db_session, "TP1")
    make_shift_now(db_session, k134)
    kiosk.last_seen_at = utc_now() - timedelta(minutes=30)
    db_session.commit()
    own = plant_head(db_session, "head.k134", k134)
    stranger = plant_head(db_session, "head.tp1", other)

    mine = _login(db_app, own.username).get("/api/v1/kiosks/status-summary").json()
    theirs = _login(db_app, stranger.username).get("/api/v1/kiosks/status-summary").json()

    assert len(mine["alerts"]) == 1 and theirs == {
        "online": 0,
        "offline": 0,
        "needs_location": 0,
        "sending": 0,
        "alerts": [],
    }


def plant_head(session: Session, username: str, plant: PlantIds) -> User:
    """A Plant Head who may see exactly one plant."""
    user = make_user(session, Role.PLANT_HEAD, username=username)
    session.add(UserPlantAccess(user_id=user.id, plant_id=uuid.UUID(plant.id)))
    session.commit()
    return user


def _login(app: FastAPI, username: str) -> TestClient:
    from tests.people_helpers import TEST_ORIGIN

    client = TestClient(app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})
    log_in(client, username)
    return client


# --- Plant readiness (spec §7 rule 15) ---------------------------------------------------------


def test_plant_readiness_shows_an_online_device_and_a_good_location(
    boss: TestClient,
    db_client: TestClient,
    device: Device,
    k134: PlantIds,
    kiosk: KioskDevice,
) -> None:
    before = boss.get(f"/api/v1/plants/{k134.id}/readiness").json()
    beat(db_client, device, report())
    after = boss.get(f"/api/v1/plants/{k134.id}/readiness").json()

    assert before["device_online"] is False and before["location_good"] is False
    assert after["device_online"] is True and after["location_good"] is True


# --- Health history and purge (F-3, AC-41) ------------------------------------------------------


def add_samples(session: Session, kiosk: KioskDevice, moments: list[datetime]) -> None:
    for moment in moments:
        session.add(
            KioskHeartbeat(
                kiosk_id=kiosk.id,
                received_at=moment,
                queue_count=0,
                location_state="good",
                camera_ok=True,
            )
        )
    session.commit()


def test_the_timeline_shows_a_gap_as_offline_and_the_rest_as_online(
    boss: TestClient, db_session: Session, kiosk: KioskDevice
) -> None:
    # Yesterday, so the samples are in the past whatever time of day the test runs.
    yesterday = utc_now().astimezone(IST).date() - timedelta(days=1)
    midnight = datetime.combine(yesterday, time.min, tzinfo=IST)
    kiosk.registered_at = midnight - timedelta(days=1)
    # One sample every 5 minutes from 01:00 to 02:00, then silence for 40 minutes, then again.
    first = [midnight + timedelta(hours=1, minutes=5 * i) for i in range(13)]
    second = [midnight + timedelta(hours=2, minutes=40 + 5 * i) for i in range(5)]
    add_samples(db_session, kiosk, first + second)
    kiosk.last_seen_at = second[-1]
    kiosk.camera_ok = True  # what the last heartbeat reported
    db_session.commit()

    response = boss.get(f"/api/v1/kiosks/{kiosk.id}/health", params={"days": 2}).json()

    day, _today = response["days"]
    assert day["date"] == yesterday.isoformat()
    offline_stretches = [s for s in day["stretches"] if s["state"] == "offline"]
    # The 40-minute silence (minus what still counts as "recently seen") is an offline stretch.
    assert any(
        datetime.fromisoformat(s["start"])
        < midnight + timedelta(hours=2, minutes=30)
        < datetime.fromisoformat(s["end"])
        for s in offline_stretches
    )
    assert response["latest"]["camera_ok"] is True  # the newest sample says the camera works


def test_health_needs_a_device_in_scope_and_at_most_7_days(
    boss: TestClient, db_app: FastAPI, db_session: Session, kiosk: KioskDevice
) -> None:
    assert boss.get(f"/api/v1/kiosks/{kiosk.id}/health", params={"days": 8}).status_code == 422
    other = create_plant(boss, db_session, "TP1")
    head = plant_head(db_session, "head.tp1", other)

    out_of_scope = _login(db_app, head.username).get(f"/api/v1/kiosks/{kiosk.id}/health")

    assert out_of_scope.status_code == 404


def test_the_daily_job_deletes_health_samples_older_than_7_days_only(
    db_session: Session, kiosk: KioskDevice
) -> None:
    now = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)
    add_samples(
        db_session,
        kiosk,
        [now - timedelta(days=8), now - timedelta(days=7, minutes=1), now - timedelta(days=6)],
    )

    deleted = purge_old_heartbeats(db_session, now)

    assert deleted == 2
    (kept,) = db_session.scalars(select(KioskHeartbeat)).all()
    assert kept.received_at == now - timedelta(days=6)
    assert purge_old_heartbeats(db_session, now) == 0  # safe to repeat
