"""Kiosk creation, pairing, signed requests and revoking (spec AC-13 to AC-17, AC-39)."""

import base64
import math
import secrets
import uuid

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.kiosks.crypto import signed_message
from app.modules.kiosks.models import KioskPairingCode
from app.modules.users.models import Role
from app.modules.users.plant_access import set_user_plant
from tests.conftest import TEST_ORIGIN
from tests.factories import log_in, make_user
from tests.test_org_api import LAT0, LON0, METRES_PER_DEGREE, square_geofence

KIOSKS = "/api/v1/kiosks"
REGISTER = "/api/v1/kiosk/register"
ME = "/api/v1/kiosk/me"


def at(east_m: float, north_m: float, accuracy_m: float = 12) -> dict:
    """A reported device location `east_m`/`north_m` metres from the geofence's corner."""
    return {
        "lat": LAT0 + north_m / METRES_PER_DEGREE,
        "lon": LON0 + east_m / (METRES_PER_DEGREE * math.cos(math.radians(LAT0))),
        "accuracy_m": accuracy_m,
    }


class Device:
    """A fake gate device: it makes a P-256 key and signs requests like WebCrypto does."""

    def __init__(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        spki = self.private_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        self.public_key = base64.b64encode(spki).decode()
        self.kiosk_id = ""
        self.counter = 0

    def headers(self, method: str, path: str, body: bytes = b"", counter: int | None = None):
        counter = counter if counter is not None else self.counter + 1
        self.counter = max(self.counter, counter)
        nonce = secrets.token_urlsafe(16)
        der = self.private_key.sign(
            signed_message(method, path, body, nonce, counter), ec.ECDSA(hashes.SHA256())
        )
        r, s = decode_dss_signature(der)
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")  # WebCrypto's format
        return {
            "X-Kiosk-Id": self.kiosk_id,
            "X-Kiosk-Nonce": nonce,
            "X-Kiosk-Counter": str(counter),
            "X-Kiosk-Signature": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(),
        }


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


@pytest.fixture
def plant(boss: TestClient) -> dict:
    created = boss.post("/api/v1/plants", json={"name": "Plant K134", "code": "K134"}).json()
    boss.put(f"/api/v1/plants/{created['id']}/geofence", json=square_geofence(100, 25))
    return created


def new_kiosk(client: TestClient, plant: dict, name: str = "Gate 1") -> dict:
    response = client.post(KIOSKS, json={"plant_id": plant["id"], "name": name})
    assert response.status_code == 201, response.text
    return response.json()


def register(client: TestClient, code: str, device: Device, location: dict | None):
    body: dict[str, object] = {"pairing_code": code, "public_key_spki": device.public_key}
    if location is not None:
        body["location"] = location
    return client.post(REGISTER, json=body)


def test_kiosk_needs_a_geofence_first(boss: TestClient) -> None:
    bare = boss.post("/api/v1/plants", json={"name": "No fence", "code": "NOF"}).json()

    response = boss.post(KIOSKS, json={"plant_id": bare["id"], "name": "Gate 1"})

    assert response.json()["error"]["code"] == "GEOFENCE_NOT_SET"


def test_phone_inside_the_geofence_pairs_and_can_call_me(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    device = Device()
    device.kiosk_id = created["kiosk"]["id"]

    response = register(boss, created["pairing_code"], device, at(50, 50, accuracy_m=18))

    assert response.status_code == 200
    assert response.json()["plant"]["code"] == "K134"
    me = boss.get(ME, headers=device.headers("GET", ME))
    assert me.status_code == 200
    assert me.json()["status"] == "active"
    listed = boss.get(KIOSKS).json()
    assert listed[0]["status"] == "active"
    assert float(listed[0]["registered_accuracy_m"]) == 18.0


@pytest.mark.parametrize(
    ("location", "code"),
    [
        (None, "LOCATION_REQUIRED"),
        (at(50, 50, accuracy_m=80), "GPS_ACCURACY_TOO_LOW"),
        (at(500, 500), "OUTSIDE_GEOFENCE"),
    ],
)
def test_pairing_is_refused_without_a_good_location(
    boss: TestClient, plant: dict, db_session: Session, location: dict | None, code: str
) -> None:
    created = new_kiosk(boss, plant)
    device = Device()

    response = register(boss, created["pairing_code"], device, location)

    assert response.json()["error"]["code"] == code
    assert boss.get(KIOSKS).json()[0]["status"] == "pending"
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "kiosk.register_failed")
    ).one()
    assert entry.after is not None and entry.after["reason"] == code
    assert created["pairing_code"] not in str(entry.after)


def test_margin_lets_a_device_just_outside_the_shape_pair(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)

    response = register(boss, created["pairing_code"], Device(), at(120, 50))  # 20 m outside

    assert response.status_code == 200


def test_wrong_used_and_expired_codes(boss: TestClient, plant: dict, db_session: Session) -> None:
    created = new_kiosk(boss, plant)
    code = created["pairing_code"]
    wrong = "000000" if code != "000000" else "111111"

    assert register(boss, wrong, Device(), at(50, 50)).json()["error"]["code"] == (
        "PAIRING_CODE_INVALID"
    )
    assert register(boss, code, Device(), at(50, 50)).status_code == 200
    assert register(boss, code, Device(), at(50, 50)).json()["error"]["code"] == (
        "PAIRING_CODE_INVALID"
    )

    second = new_kiosk(boss, plant, "Gate 2")
    row = db_session.scalars(
        select(KioskPairingCode).where(
            KioskPairingCode.kiosk_id == uuid.UUID(second["kiosk"]["id"])
        )
    ).one()
    from datetime import timedelta

    from app.core.time import utc_now

    row.expires_at = utc_now() - timedelta(seconds=1)
    db_session.commit()
    expired = register(boss, second["pairing_code"], Device(), at(50, 50))
    assert expired.json()["error"]["code"] == "PAIRING_CODE_EXPIRED"


def test_five_refusals_use_up_the_code(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)

    for _ in range(5):
        register(boss, created["pairing_code"], Device(), at(500, 500))
    locked = register(boss, created["pairing_code"], Device(), at(50, 50))

    assert locked.json()["error"]["code"] == "PAIRING_LOCKED"


def test_new_code_replaces_the_old_one(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    again = boss.post(f"{KIOSKS}/{created['kiosk']['id']}/pairing-code").json()

    old = register(boss, created["pairing_code"], Device(), at(50, 50))
    fresh = register(boss, again["pairing_code"], Device(), at(50, 50))

    assert old.status_code == 400
    assert fresh.status_code == 200


def test_signed_requests_are_checked(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    device = Device()
    device.kiosk_id = created["kiosk"]["id"]
    register(boss, created["pairing_code"], device, at(50, 50))

    stranger = Device()
    stranger.kiosk_id = device.kiosk_id
    tampered_path = device.headers("GET", "/api/v1/kiosk/other")
    wrong_key = stranger.headers("GET", ME)
    first = device.headers("GET", ME, counter=10)
    replay = device.headers("GET", ME, counter=10)

    assert boss.get(ME, headers=tampered_path).json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"
    assert boss.get(ME, headers=wrong_key).json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"
    assert boss.get(ME, headers=first).status_code == 200
    assert boss.get(ME, headers=replay).json()["error"]["code"] == "NONCE_REUSED"
    assert boss.get(ME).json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"


def test_revoked_kiosk_is_refused(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    device = Device()
    device.kiosk_id = created["kiosk"]["id"]
    register(boss, created["pairing_code"], device, at(50, 50))

    revoked = boss.post(f"{KIOSKS}/{device.kiosk_id}/revoke", json={"reason": "Tablet lost"})

    assert revoked.json()["status"] == "revoked"
    assert boss.get(ME, headers=device.headers("GET", ME)).json()["error"]["code"] == (
        "DEVICE_REVOKED"
    )
    assert (
        boss.post(f"/api/v1/plants/{plant['id']}/deactivate", json={"reason": "x y z"}).status_code
        == 200
    )


def test_plant_with_an_active_kiosk_cannot_be_switched_off(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    register(boss, created["pairing_code"], Device(), at(50, 50))

    response = boss.post(f"/api/v1/plants/{plant['id']}/deactivate", json={"reason": "Closing"})

    assert response.json()["error"]["code"] == "PLANT_HAS_ACTIVE_KIOSKS"


def test_pairing_qr_works_only_while_the_code_is_valid(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    url = f"{KIOSKS}/{created['kiosk']['id']}/pairing-qr.svg"

    ok = boss.get(url, params={"code": created["pairing_code"]})
    wrong = boss.get(url, params={"code": "000000"})

    assert ok.status_code == 200
    assert ok.headers["content-type"] == "image/svg+xml"
    assert ok.text.lstrip().startswith("<svg")
    assert wrong.json()["error"]["code"] == "PAIRING_CODE_EXPIRED"


def test_plant_head_manages_only_their_own_plants_kiosks(
    boss: TestClient, plant: dict, db_app: FastAPI, db_session: Session
) -> None:
    other = boss.post("/api/v1/plants", json={"name": "Other", "code": "TP1"}).json()
    boss.put(f"/api/v1/plants/{other['id']}/geofence", json=square_geofence())
    head = make_user(db_session, Role.PLANT_HEAD, username="k134.head")
    set_user_plant(db_session, head, uuid.UUID(plant["id"]))
    db_session.commit()
    head_client = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(head_client, "k134.head")

    own = head_client.post(KIOSKS, json={"plant_id": plant["id"], "name": "Gate 1"})
    foreign = head_client.post(KIOSKS, json={"plant_id": other["id"], "name": "Gate 1"})

    assert own.status_code == 201
    assert foreign.status_code == 404
    assert len(head_client.get(KIOSKS).json()) == 1


def test_corporate_head_can_read_but_not_create_kiosks(
    boss: TestClient, plant: dict, db_app: FastAPI, db_session: Session
) -> None:
    new_kiosk(boss, plant)
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    corporate = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(corporate, "corp.head")

    assert len(corporate.get(KIOSKS).json()) == 1
    created = corporate.post(KIOSKS, json={"plant_id": plant["id"], "name": "Gate 2"})
    assert created.json()["error"]["code"] == "FORBIDDEN"


def test_a_stranger_cannot_learn_that_a_kiosk_is_revoked(boss: TestClient, plant: dict) -> None:
    created = new_kiosk(boss, plant)
    device = Device()
    device.kiosk_id = created["kiosk"]["id"]
    register(boss, created["pairing_code"], device, at(50, 50))
    boss.post(f"{KIOSKS}/{device.kiosk_id}/revoke", json={"reason": "Tablet lost"})

    stranger = Device()
    stranger.kiosk_id = device.kiosk_id
    answer = boss.get(ME, headers=stranger.headers("GET", ME))

    # Without the device's own key the answer is the same "not paired" as for any unknown id.
    assert answer.json()["error"]["code"] == "DEVICE_SIGNATURE_INVALID"


def test_wrong_codes_from_anyone_are_capped_even_when_the_ip_changes(
    boss: TestClient, plant: dict
) -> None:
    new_kiosk(boss, plant)
    guesses = 0
    last = None
    # Each guess comes from a different (spoofable) IP, so the per-IP limit never triggers.
    for number in range(40):
        headers = {"X-Forwarded-For": f"10.0.0.{number}"}
        last = boss.post(
            "/api/v1/kiosk/register",
            json={
                "pairing_code": f"{number:06d}"[::-1],
                "public_key_spki": Device().public_key,
                "location": at(50, 50),
            },
            headers=headers,
        )
        guesses += 1
        if last.status_code == 429:
            break

    assert last is not None and last.status_code == 429
    assert guesses <= 32
