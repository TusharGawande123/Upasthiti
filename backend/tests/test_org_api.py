"""Plants, setup wizard, readiness, geofences, departments, shifts, categories
(spec AC-3, AC-6, AC-7, AC-11, AC-31, AC-38)."""

import math
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.users.models import Role
from app.modules.users.plant_access import set_user_plant
from tests.conftest import TEST_ORIGIN
from tests.factories import log_in, make_user

LON0, LAT0 = 75.2190, 19.8400
METRES_PER_DEGREE = 6_371_008.8 * math.pi / 180


def square_geofence(size_m: float = 100, buffer_m: int = 25) -> dict:
    def corner(east: float, north: float) -> list[float]:
        return [
            LON0 + east / (METRES_PER_DEGREE * math.cos(math.radians(LAT0))),
            LAT0 + north / METRES_PER_DEGREE,
        ]

    ring = [corner(0, 0), corner(size_m, 0), corner(size_m, size_m), corner(0, size_m)]
    return {
        "shape": "polygon",
        "geojson": {"type": "Polygon", "coordinates": [[*ring, ring[0]]]},
        "buffer_m": buffer_m,
    }


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


def create_plant(client: TestClient, code: str = "K134") -> dict:
    response = client.post("/api/v1/plants", json={"name": f"Plant {code}", "code": code})
    assert response.status_code == 201, response.text
    return response.json()


def test_new_plant_gets_the_default_shift_and_categories(boss: TestClient) -> None:
    plant = create_plant(boss)

    shifts = boss.get(f"/api/v1/plants/{plant['id']}/shifts").json()
    categories = boss.get(f"/api/v1/plants/{plant['id']}/categories").json()

    assert [(s["name"], s["start_time"], s["end_time"]) for s in shifts] == [
        ("General", "07:00:00", "19:00:00")
    ]
    assert shifts[0]["grace_min"] == 10
    assert shifts[0]["half_day_min"] == 240
    assert shifts[0]["ot_after_min"] == 480
    assert {c["name"] for c in categories} == {"Staff", "Worker", "Operator", "Helper"}


def test_plant_codes_are_unique_and_upper_case(boss: TestClient) -> None:
    create_plant(boss, "k134")

    again = boss.post("/api/v1/plants", json={"name": "Copy", "code": "K134"})
    bad = boss.post("/api/v1/plants", json={"name": "Bad", "code": "k-1"})

    assert again.json()["error"]["code"] == "PLANT_CODE_EXISTS"
    assert bad.json()["error"]["code"] == "PLANT_CODE_INVALID"


def test_client_plants_are_added_once(boss: TestClient) -> None:
    first = boss.post("/api/v1/setup/client-plants").json()
    second = boss.post("/api/v1/setup/client-plants").json()

    assert first == {"created": 7, "skipped": 0}
    assert second == {"created": 0, "skipped": 7}
    assert boss.get("/api/v1/plants").json()["total"] == 7


def test_geofence_versions_are_kept(boss: TestClient) -> None:
    plant = create_plant(boss)
    url = f"/api/v1/plants/{plant['id']}/geofence"

    assert boss.put(url, json=square_geofence(100)).json()["version"] == 1
    assert boss.put(url, json=square_geofence(150)).json()["version"] == 2

    versions = boss.get(f"{url}/versions").json()
    assert [(v["version"], v["is_current"]) for v in versions] == [(2, True), (1, False)]
    assert boss.get(url).json()["version"] == 2


def test_self_crossing_geofence_is_refused(boss: TestClient) -> None:
    plant = create_plant(boss)
    body = square_geofence()
    ring = body["geojson"]["coordinates"][0]
    ring[1], ring[2] = ring[2], ring[1]  # swap corners: the edges now cross

    response = boss.put(f"/api/v1/plants/{plant['id']}/geofence", json=body)

    assert response.json()["error"]["code"] == "GEOFENCE_INVALID"
    assert response.json()["error"]["details"]["reason"] == "crosses_itself"


def test_night_shift_crosses_midnight_and_equal_times_are_refused(boss: TestClient) -> None:
    plant = create_plant(boss)
    url = f"/api/v1/plants/{plant['id']}/shifts"

    night = boss.post(url, json={"name": "Night", "start_time": "20:00", "end_time": "07:00"})
    same = boss.post(url, json={"name": "Odd", "start_time": "07:00", "end_time": "07:00"})

    assert night.json()["crosses_midnight"] is True
    assert "ot_rate" not in night.json()
    assert same.json()["error"]["code"] == "SHIFT_TIMES_INVALID"


def test_shift_names_are_unique_per_plant(boss: TestClient) -> None:
    plant = create_plant(boss)

    response = boss.post(
        f"/api/v1/plants/{plant['id']}/shifts",
        json={"name": "general", "start_time": "08:00", "end_time": "16:00"},
    )

    assert response.json()["error"]["code"] == "SHIFT_EXISTS"


def test_department_rename_and_deactivate(boss: TestClient) -> None:
    plant = create_plant(boss)
    department = boss.post(
        f"/api/v1/plants/{plant['id']}/departments", json={"name": "Press shop"}
    ).json()

    renamed = boss.patch(f"/api/v1/departments/{department['id']}", json={"name": "Pressing"})
    switched_off = boss.post(
        f"/api/v1/departments/{department['id']}/deactivate", json={"reason": "Merged"}
    )

    assert renamed.json()["name"] == "Pressing"
    assert switched_off.json()["is_active"] is False


def test_setup_status_and_readiness(boss: TestClient) -> None:
    before = {
        step["key"]: step["done"] for step in boss.get("/api/v1/setup/status").json()["steps"]
    }
    plant = create_plant(boss)
    boss.put(f"/api/v1/plants/{plant['id']}/geofence", json=square_geofence())
    after = {step["key"]: step["done"] for step in boss.get("/api/v1/setup/status").json()["steps"]}
    readiness = boss.get(f"/api/v1/plants/{plant['id']}/readiness").json()

    assert not any(before.values())
    assert after["plants"] and after["geofence"] and after["shifts_and_categories"]
    assert readiness["geofence"] is True
    assert readiness["active_kiosks"] == 0
    assert readiness["ready"] is False


def test_plant_head_sees_only_their_plant_and_changes_nothing(
    boss: TestClient, db_app: FastAPI, db_session: Session
) -> None:
    own = create_plant(boss, "K134")
    other = create_plant(boss, "TP1")
    head = make_user(db_session, Role.PLANT_HEAD, username="k134.head")
    set_user_plant(db_session, head, uuid.UUID(own["id"]))
    db_session.commit()
    head_client = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(head_client, "k134.head")

    listed = head_client.get("/api/v1/plants").json()
    other_plant = head_client.get(f"/api/v1/plants/{other['id']}")
    edit = head_client.patch(f"/api/v1/plants/{own['id']}", json={"name": "Mine"})
    geofence = head_client.put(f"/api/v1/plants/{own['id']}/geofence", json=square_geofence())

    assert [plant["code"] for plant in listed["items"]] == ["K134"]
    assert other_plant.status_code == 404
    assert edit.json()["error"]["code"] == "FORBIDDEN"
    assert geofence.json()["error"]["code"] == "FORBIDDEN"


def test_corporate_head_reads_every_plant_but_cannot_create(
    boss: TestClient, db_app: FastAPI, db_session: Session
) -> None:
    create_plant(boss, "K134")
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    corporate = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(corporate, "corp.head")

    assert corporate.get("/api/v1/plants").json()["total"] == 1
    created = corporate.post("/api/v1/plants", json={"name": "New", "code": "NEW"})
    assert created.json()["error"]["code"] == "FORBIDDEN"


def test_super_admin_can_now_create_a_plant_head(boss: TestClient) -> None:
    plant = create_plant(boss)

    response = boss.post(
        "/api/v1/users",
        json={
            "name": "K Head",
            "username": "k.head",
            "role": "plant_head",
            "plant_id": plant["id"],
        },
    )

    assert response.status_code == 201
    assert response.json()["user"]["plant_id"] == plant["id"]
