"""Helpers for the phone API tests (M4b P1): a phone client, the spec's people F-201 and Q-301
(spec §10 common setup), switches, passwords and proofs. All data is fake."""

import uuid
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utc_now
from app.modules.auth.passwords import hash_password
from app.modules.phone.models import PhoneAccount, PhoneSession
from app.modules.qr_cards.payload import build_payload
from tests.conftest import TEST_ORIGIN
from tests.face_helpers import enrol, frame, new_employee
from tests.kiosk_helpers import GATE_LOCATION, ensure_gate_fence
from tests.people_helpers import PlantIds, temporary_body

PHONE = "/api/v1/phone"
GOOD_PASSWORD = "Ganesh@2026"  # noqa: S105 (a test password)
ANDROID_CHROME = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Mobile Safari/537.36"
)
IPHONE_SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
SAMSUNG = (
    "Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) "
    "SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36"
)
# About 2 km north of the test gate (outside the 200 m fence and its 25 m margin).
FAR_AWAY = {"lat": 19.868, "lon": 75.25, "accuracy_m": 15.0, "age_s": 2}


def phone_client(app: FastAPI, user_agent: str = ANDROID_CHROME) -> TestClient:
    """A phone browser. HTTPS, because the `ups_phone` cookie is Secure outside development."""
    return TestClient(
        app,
        base_url="https://testserver",
        raise_server_exceptions=False,
        headers={"Origin": TEST_ORIGIN, "User-Agent": user_agent},
    )


@dataclass
class People:
    face_id: str  # F-201, person 1 of the fake face engine, enrolled with consent
    qr_id: str  # Q-301, temporary worker with a valid card
    card_text: str


def make_people(boss: TestClient, session: Session, plant: PlantIds) -> People:
    ensure_gate_fence(session, uuid.UUID(plant.id))
    face_id = new_employee(boss, plant, code="F-201")
    assert enrol(boss, face_id, person=1).status_code == 201
    body = temporary_body(plant) | {"employee_code": "Q-301", "full_name": "Ramesh Pawar"}
    worker = boss.post("/api/v1/employees", json=body)
    assert worker.status_code == 201, worker.text
    qr_id = worker.json()["id"]
    card = boss.post(f"/api/v1/employees/{qr_id}/qr-cards", json={}).json()["card"]
    return People(face_id, qr_id, build_payload(get_settings(), card["serial"]))


def switch_phone(boss: TestClient, employee_id: str, on: bool = True):
    return boss.put(
        f"/api/v1/employees/{employee_id}/phone/access",
        json={"phone_punch_enabled": on, "reason": "Site visits"},
    )


def give_password(session: Session, employee_id: str, password: str = GOOD_PASSWORD) -> None:
    """A password set straight in the database (the proof flow has its own tests)."""
    account = session.scalar(
        select(PhoneAccount).where(PhoneAccount.employee_id == uuid.UUID(employee_id))
    )
    if account is None:
        account = PhoneAccount(employee_id=uuid.UUID(employee_id), failed_login_count=0)
        session.add(account)
    account.password_hash = hash_password(password)
    account.password_set_at = utc_now()
    account.proof_kind = "face"
    account.new_password_required_at = None
    session.commit()


def sign_in(client: TestClient, code: str = "F-201", password: str = GOOD_PASSWORD):
    return client.post(f"{PHONE}/login", json={"employee_code": code, "password": password})


def turn_yaw(challenge_name: str) -> float:
    return 25.0 if challenge_name in ("turn_left", "left_then_right") else -25.0


def face_proof(client: TestClient, code: str, person: int, **frame_options: object):
    given = client.post(f"{PHONE}/proof/face/challenge", json={"employee_code": code})
    assert given.status_code == 200, given.text
    challenge = given.json()
    frames = [
        frame(person, **frame_options),  # type: ignore[arg-type]
        frame(person, yaw=turn_yaw(challenge["challenge"]), role="turn"),
        frame(person, **frame_options),  # type: ignore[arg-type]
    ]
    return client.post(
        f"{PHONE}/proof/face",
        json={
            "proof_id": challenge["proof_id"],
            "challenge_nonce": challenge["challenge_nonce"],
            "frames": frames,
        },
    )


def card_proof(client: TestClient, card_text: str, location: dict | None = GATE_LOCATION):
    return client.post(f"{PHONE}/proof/card", json={"qr_payload": card_text, "location": location})


def set_password(client: TestClient, token: str, password: str = GOOD_PASSWORD):
    return client.post(f"{PHONE}/password", json={"proof_token": token, "new_password": password})


def sessions_of(session: Session, employee_id: str) -> list[PhoneSession]:
    session.expire_all()
    return list(
        session.scalars(
            select(PhoneSession)
            .where(PhoneSession.employee_id == uuid.UUID(employee_id))
            .order_by(PhoneSession.created_at)
        )
    )
