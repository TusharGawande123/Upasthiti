"""M4: location on every punch, flagged punches, the travel and two-device flags, and what
counts after a review (spec M4 §7 rules 2, 4, 5, 6, 14; AC-1, AC-3, AC-4, AC-6, AC-7)."""

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
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Geofence
from app.modules.punches.models import Punch, PunchReview
from app.modules.qr_cards.payload import build_payload
from app.modules.settings.models import SettingValue
from app.modules.users.models import Role, User
from tests.conftest import clear_cached_settings
from tests.kiosk_helpers import (
    GATE_FENCE_RADIUS_M,
    GATE_LAT,
    GATE_LOCATION,
    GATE_LON,
    Device,
    make_active_kiosk,
)
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, punch_rows, send

METRES_PER_DEGREE_LAT = 111_195.0


def north_of_gate(metres: float, accuracy_m: float = 12.0) -> dict[str, float]:
    """A reading `metres` north of the gate (the fence is a circle around the gate)."""
    return {
        "lat": GATE_LAT + metres / METRES_PER_DEGREE_LAT,
        "lon": GATE_LON,
        "accuracy_m": accuracy_m,
        "age_s": 2,
    }


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


def set_setting(session: Session, key: str, value: int) -> None:
    session.merge(SettingValue(key=key, value=value))
    session.commit()


def add_counted_punch(
    session: Session,
    kiosk: KioskDevice,
    worker: Worker,
    age: timedelta,
    *,
    direction: str = "in",
    lat: float | None = None,
    lon: float | None = None,
    decision: str = "accepted",
    reason_codes: list[str] | None = None,
) -> Punch:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=worker.employee_id,
        qr_credential_id=worker.card_id,
        method="qr",
        direction=direction if decision != "rejected" else None,
        decision=decision,
        reason_codes=reason_codes or [],
        server_received_at=utc_now() - age,
        lat=lat,
        lon=lon,
    )
    session.add(punch)
    session.commit()
    return punch


def other_device_same_plant(session: Session, k134: PlantIds) -> KioskDevice:
    return make_active_kiosk(session, k134, Device(), name="Second gate")


# --- Location on every punch (AC-1, AC-3, AC-4) -----------------------------------------------


def test_a_punch_inside_the_fence_stores_the_place(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "accepted" and answer["direction"] == "in"
    (punch,) = punch_rows(db_session)
    fence = db_session.scalars(select(Geofence).where(Geofence.plant_id == kiosk.plant_id)).one()
    assert punch.decision == "accepted" and punch.reason_codes == []
    assert punch.geofence_id == fence.id and punch.geofence_distance_m == 0
    assert punch.location_age_s == GATE_LOCATION["age_s"]
    assert punch.punch_time == punch.server_received_at


@pytest.mark.parametrize(
    ("location", "code"),
    [
        (None, "LOCATION_REQUIRED"),
        (north_of_gate(0, accuracy_m=120), "GPS_ACCURACY_TOO_LOW"),
        (north_of_gate(GATE_FENCE_RADIUS_M + 200), "OUTSIDE_GEOFENCE"),
    ],
)
def test_a_device_without_a_good_place_is_refused(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    location: dict | None,
    code: str,
) -> None:
    answer = send(db_client, device, worker.qr_text, location=location).json()

    assert answer["decision"] == "rejected" and answer["reason_code"] == code
    assert answer["employee"] is None  # no name for a refused place
    (punch,) = punch_rows(db_session)
    assert punch.decision == "rejected" and punch.reason_codes == [code]


def test_a_plant_without_a_fence_refuses_the_punch(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    db_session.query(Geofence).filter(Geofence.plant_id == kiosk.plant_id).update(
        {"is_current": False}
    )
    db_session.commit()

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["reason_code"] == "GEOFENCE_NOT_SET"


def test_a_reading_at_the_edge_counts_and_is_flagged(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    answer = send(
        db_client, device, worker.qr_text, location=north_of_gate(GATE_FENCE_RADIUS_M + 18)
    ).json()

    # The gate sees a normal IN; the flag is for the Super Admin only.
    assert answer["decision"] == "accepted" and answer["direction"] == "in"
    assert answer["reason_code"] is None  # the gate never learns a flag code
    (punch,) = punch_rows(db_session)
    assert punch.decision == "flagged" and punch.reason_codes == ["LOCATION_AT_EDGE"]
    assert punch.direction == "in" and 17 < float(punch.geofence_distance_m or 0) < 19


def test_a_flagged_in_counts_for_the_next_punch(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    add_counted_punch(
        db_session,
        kiosk,
        worker,
        timedelta(hours=2),
        decision="flagged",
        reason_codes=["LOCATION_AT_EDGE"],
    )

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["direction"] == "out"


def test_a_test_card_is_never_refused_for_its_place_and_reports_it(
    boss: TestClient, db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate test"}).json()
    qr_text = build_payload(get_settings(), card["serial"])

    outside = north_of_gate(GATE_FENCE_RADIUS_M + 300)
    answer = send(db_client, device, qr_text, location=outside).json()
    good = send(db_client, device, qr_text).json()

    assert answer["decision"] == "self_test"
    assert answer["details"]["location_check"] == "OUTSIDE_GEOFENCE"
    assert good["details"]["location_check"] == "ok"


# --- Reviews change what counts (§7 rule 6) ---------------------------------------------------


def add_review(session: Session, punch: Punch, action: str, direction: str | None = None) -> None:
    user = session.scalars(select(User).where(User.username == "boss")).one()
    session.add(
        PunchReview(
            punch_id=punch.id,
            action=action,
            direction=direction,
            employee_id=worker_id_of(punch),
            reason="Checked at the office" if action != "confirmed" else None,
            reviewed_by=user.id,
            reviewed_at=utc_now(),
        )
    )
    session.commit()


def worker_id_of(punch: Punch) -> uuid.UUID | None:
    return punch.employee_id


def test_a_flagged_in_marked_not_accepted_stops_counting(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    flagged = add_counted_punch(
        db_session,
        kiosk,
        worker,
        timedelta(hours=2),
        decision="flagged",
        reason_codes=["TWO_DEVICES_SOON"],
    )
    add_review(db_session, flagged, "not_accepted")

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["direction"] == "in"  # the IN of two hours ago no longer counts


def test_an_approved_rejected_punch_counts_with_the_chosen_direction(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    refused = add_counted_punch(
        db_session,
        kiosk,
        worker,
        timedelta(hours=2),
        decision="rejected",
        reason_codes=["OUTSIDE_GEOFENCE"],
    )
    add_review(db_session, refused, "approved", direction="in")

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["direction"] == "out"


# --- Two devices and impossible travel (AC-6, AC-7) -------------------------------------------


@pytest.mark.parametrize(("minutes", "flagged"), [(4, True), (11, False)])
def test_the_same_card_at_another_device_soon_is_flagged(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    minutes: int,
    flagged: bool,
) -> None:
    set_setting(db_session, "min_minutes_before_out", 2)  # so the OUT itself is allowed
    first = add_counted_punch(
        db_session, other_device_same_plant(db_session, k134), worker, timedelta(minutes=minutes)
    )

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "accepted" and answer["direction"] == "out"
    (_, second) = punch_rows(db_session)
    if flagged:
        assert second.decision == "flagged" and second.reason_codes == ["TWO_DEVICES_SOON"]
        assert second.related_punch_id == first.id
    else:
        assert second.decision == "accepted" and second.related_punch_id is None


@pytest.mark.parametrize(("metres_away", "flagged"), [(3000, True), (400, False)])
def test_a_trip_faster_than_the_limit_is_flagged(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
    metres_away: float,
    flagged: bool,
) -> None:
    set_setting(db_session, "min_minutes_before_out", 2)
    set_setting(db_session, "same_person_two_devices_minutes", 1)  # only the travel rule here
    far = north_of_gate(metres_away)
    first = add_counted_punch(
        db_session,
        other_device_same_plant(db_session, k134),
        worker,
        timedelta(minutes=2),
        lat=far["lat"],
        lon=far["lon"],
    )

    answer = send(db_client, device, worker.qr_text).json()

    assert answer["decision"] == "accepted"  # never a rejection
    (_, second) = punch_rows(db_session)
    if flagged:  # 3 km in 2 minutes = 90 km/h, above 60
        assert second.reason_codes == ["IMPOSSIBLE_TRAVEL"]
        assert second.related_punch_id == first.id
    else:  # 400 m is below the 500 m minimum
        assert second.decision == "accepted"


def test_both_flags_are_kept_in_rule_order(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    worker: Worker,
) -> None:
    set_setting(db_session, "min_minutes_before_out", 2)
    far = north_of_gate(3000)
    add_counted_punch(
        db_session,
        other_device_same_plant(db_session, k134),
        worker,
        timedelta(minutes=2),
        lat=far["lat"],
        lon=far["lon"],
    )

    send(db_client, device, worker.qr_text, location=north_of_gate(GATE_FENCE_RADIUS_M + 10))

    (_, second) = punch_rows(db_session)
    assert second.reason_codes == ["LOCATION_AT_EDGE", "IMPOSSIBLE_TRAVEL", "TWO_DEVICES_SOON"]


def test_a_rejection_keeps_the_flags_found_before_it(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, worker: Worker
) -> None:
    send(
        db_client,
        device,
        worker.qr_text,
        location=north_of_gate(GATE_FENCE_RADIUS_M + 10),
        snapshot=None,
    )

    (punch,) = punch_rows(db_session)
    assert punch.decision == "rejected"
    assert punch.reason_codes == ["SNAPSHOT_MISSING", "LOCATION_AT_EDGE"]


# --- Settings (§7 rule 17) --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("values", "key"),
    [
        (
            {"kiosk_offline_after_minutes": 10, "kiosk_offline_alert_minutes": 5},
            "kiosk_offline_alert_minutes",
        ),
        (
            {"kiosk_location_refresh_seconds": 60, "kiosk_location_max_age_seconds": 60},
            "kiosk_location_max_age_seconds",
        ),
    ],
)
def test_m4_settings_that_only_make_sense_in_order(
    boss: TestClient, values: dict[str, int], key: str
) -> None:
    response = boss.put("/api/v1/settings", json={"values": values, "reason": "Testing the order"})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "SETTING_INVALID" and error["details"]["key"] == key


def test_m4_settings_are_editable_with_a_reason(boss: TestClient) -> None:
    response = boss.put(
        "/api/v1/settings",
        json={"values": {"impossible_travel_kmh": 80, "offline_max_hours": 96}, "reason": "Pilot"},
    )

    assert response.status_code == 200, response.text
    saved = {item["key"]: item["value"] for item in response.json()["settings"]}
    assert saved["impossible_travel_kmh"] == 80 and saved["offline_max_hours"] == 96


# --- The gate learns its fence from the heartbeat (§5.1) ----------------------------------------


def test_the_heartbeat_sends_the_fence_and_the_location_limits(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    path = "/api/v1/kiosk/me"
    me = db_client.get(path, headers=device.headers("GET", path)).json()

    location = me["kiosk_settings"]["location"]
    assert location["accuracy_limit_m"] == 50 and location["max_age_seconds"] == 120
    assert location["refresh_seconds"] == 30
    fence = location["geofence"]
    assert fence["shape"] == "circle" and fence["radius_m"] == GATE_FENCE_RADIUS_M
    assert fence["geojson"]["coordinates"] == [GATE_LON, GATE_LAT] and fence["buffer_m"] == 25
