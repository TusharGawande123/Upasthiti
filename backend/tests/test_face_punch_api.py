"""The face punch at the gate, end to end through the signed API (spec M3 §5.1, §5.2, §7 rules 5,
7, 14; AC-9 to AC-16, AC-23, AC-26 to AC-29, AC-40). Real PostgreSQL, fake face engine."""

import base64
import json
import logging
import threading
import time
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import (
    FaceDecryptionError,
    SealedVector,
    decode_key,
    open_vector,
    pending_match_binding,
)
from app.core.time import today_ist, utc_now
from app.face.engine import FaceEngine
from app.face.fake_engine import FakeFaceModels, Problem
from app.modules.auth.rate_limit import code_try_limiter
from app.modules.face.engine_provider import get_face_engine
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import (
    FacePendingMatch,
    Punch,
    PunchChallenge,
    PunchSnapshot,
)
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant

PUNCH = "/api/v1/punch/kiosk"
CHALLENGE = "/api/v1/punch/challenge"
CODE = "/api/v1/punch/kiosk/code"


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


@pytest.fixture
def device() -> Device:
    return Device()


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds, device: Device) -> KioskDevice:
    return make_active_kiosk(db_session, k134, device)


@pytest.fixture
def ravi(boss: TestClient, k134: PlantIds) -> str:
    """Person 1, enrolled at K134 with code 1043."""
    employee_id = new_employee(boss, k134, code="1043")
    assert enrol(boss, employee_id, person=1).status_code == 201
    return employee_id


def signed_post(client: TestClient, device: Device, path: str, body: dict):
    raw = json.dumps(body).encode()
    headers = device.headers("POST", path, raw) | {"Content-Type": "application/json"}
    return client.post(path, content=raw, headers=headers)


def challenge(client: TestClient, device: Device) -> dict:
    response = signed_post(client, device, CHALLENGE, {})
    assert response.status_code == 200, response.text
    return response.json()


def turn_yaw(challenge_name: str) -> float:
    return 25.0 if challenge_name in ("turn_left", "left_then_right") else -25.0


def face_punch(
    client: TestClient,
    device: Device,
    person: int,
    *,
    frames: list[dict] | None = None,
    nonce: str | None = None,
    client_punch_id: str | None = None,
    turn_person: int | None = None,
    problem: Problem = Problem.NONE,
):
    given = challenge(client, device) if nonce is None else None
    if frames is None:
        assert given is not None
        frames = [
            frame(person, problem=problem),
            frame(turn_person or person, yaw=turn_yaw(given["challenge"]), role="turn"),
            frame(person, problem=problem),
        ]
    body = {
        "client_punch_id": client_punch_id or str(uuid.uuid4()),
        "method": "face",
        "challenge_nonce": nonce or (given or {})["challenge_nonce"],
        "frames": frames,
    }
    return signed_post(client, device, PUNCH, body)


def code_try(client: TestClient, device: Device, token: str, code: str, client_punch_id=None):
    body = {
        "client_punch_id": client_punch_id or str(uuid.uuid4()),
        "code_entry_token": token,
        "employee_code": code,
    }
    return signed_post(client, device, CODE, body)


def face_key() -> bytes:
    key = get_settings().face_template_key
    assert key is not None
    return decode_key(key.get_secret_value())


# --- Accepted by face (AC-9, AC-10) ------------------------------------------------------------


def test_an_enrolled_employee_is_accepted_by_face_without_a_photo(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    response = face_punch(db_client, device, person=1)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["decision"], body["direction"]) == ("accepted", "in")
    assert body["employee"] == {"display_name": "Worker 1043", "employee_code": "1043"}
    assert body["code_entry"] is None
    punch = db_session.scalars(select(Punch)).one()
    assert punch.method == "face" and punch.match_mode == "one_to_many"
    assert punch.employee_id == uuid.UUID(ravi)
    assert punch.challenge in ("turn_left", "turn_right") and punch.face_model_id == "fake/fake"
    assert punch.match_score is not None and float(punch.match_score) > 0.99
    assert punch.antispoof_score is not None and abs(float(punch.yaw_degrees or 0)) >= 18
    assert db_session.scalars(select(PunchSnapshot)).all() == []  # accepted: no image kept


def test_a_second_face_punch_soon_after_is_already_in(
    db_client: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    face_punch(db_client, device, person=1)

    again = face_punch(db_client, device, person=1).json()

    assert again["decision"] == "rejected" and again["reason_code"] == "COOLDOWN_ACTIVE"
    assert again["employee"]["employee_code"] == "1043"
    assert again["details"]["last_direction"] == "in"


def test_the_heartbeat_offers_face_punch_once_someone_is_enrolled(
    db_client: TestClient, boss: TestClient, k134: PlantIds, device: Device, kiosk: KioskDevice
) -> None:
    path = "/api/v1/kiosk/me"
    before = db_client.get(path, headers=device.headers("GET", path)).json()
    assert before["kiosk_settings"]["face"]["enabled_for_plant"] is False

    enrol(boss, new_employee(boss, k134, code="1050"), person=5)

    after = db_client.get(path, headers=device.headers("GET", path)).json()
    assert after["kiosk_settings"]["face"] | {"available": True} == after["kiosk_settings"]["face"]
    assert after["kiosk_settings"]["face"]["enabled_for_plant"] is True


# --- Challenge (AC-11) --------------------------------------------------------------------------


def test_a_challenge_is_random_short_lived_and_hashed(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice
) -> None:
    given = challenge(db_client, device)

    assert len(given["challenge_nonce"]) == 22
    assert given["challenge"] in ("turn_left", "turn_right")
    assert given["capture"]["max_frames"] == 4 and given["capture"]["min_yaw_degrees"] == 18
    stored = db_session.scalars(select(PunchChallenge)).one()
    assert stored.nonce_sha256 != given["challenge_nonce"]  # only the hash is kept
    assert (stored.expires_at - stored.issued_at) == timedelta(seconds=10)


def test_a_used_or_foreign_challenge_is_refused(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    ravi: str,
) -> None:
    given = challenge(db_client, device)
    yaw = turn_yaw(given["challenge"])
    frames = [frame(1), frame(1, yaw=yaw, role="turn")]
    first = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"]).json()
    assert first["decision"] == "accepted"

    reused = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"])
    assert reused.json()["reason_code"] == "CHALLENGE_INVALID"

    other_device = Device()
    make_active_kiosk(db_session, k134, other_device, name="Back gate")
    foreign = challenge(db_client, other_device)
    answer = face_punch(db_client, device, 1, frames=frames, nonce=foreign["challenge_nonce"])
    assert answer.json()["reason_code"] == "CHALLENGE_INVALID"


def test_an_old_challenge_is_too_slow_and_may_be_retried(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    given = challenge(db_client, device)
    stored = db_session.scalars(select(PunchChallenge)).one()
    stored.issued_at = utc_now() - timedelta(seconds=30)
    stored.expires_at = utc_now() - timedelta(seconds=11)
    db_session.commit()
    frames = [frame(1), frame(1, yaw=turn_yaw(given["challenge"]), role="turn")]

    answer = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"])

    assert answer.json()["reason_code"] == "CHALLENGE_EXPIRED"
    assert answer.json()["details"]["retry_allowed"] is True


def test_two_step_challenges_when_the_setting_asks_for_them(
    db_client: TestClient, boss: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    boss.put("/api/v1/settings", json={"values": {"face_challenge_steps": 2}, "reason": "F-43"})
    given = challenge(db_client, device)
    assert given["challenge"] in ("left_then_right", "right_then_left")
    first = turn_yaw(given["challenge"])
    good = [frame(1), frame(1, yaw=first, role="turn"), frame(1, yaw=-first, role="turn")]

    accepted = face_punch(db_client, device, 1, frames=good, nonce=given["challenge_nonce"])
    assert accepted.json()["decision"] == "accepted"

    again = challenge(db_client, device)
    one_turn = [frame(1), frame(1, yaw=turn_yaw(again["challenge"]), role="turn")]
    refused = face_punch(db_client, device, 1, frames=one_turn, nonce=again["challenge_nonce"])
    assert refused.json()["reason_code"] == "LIVENESS_FAILED"


# --- Refused faces (AC-12, AC-23) ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("problem", "reason"),
    [
        (Problem.TWO_FACES, "MULTIPLE_FACES"),
        (Problem.SMALL_FACE, "FACE_TOO_SMALL"),
        (Problem.DARK, "FACE_QUALITY_LOW"),
        (Problem.BLURRY, "FACE_QUALITY_LOW"),
        (Problem.SPOOF, "SPOOF_SUSPECTED"),
    ],
)
def test_bad_frames_are_refused_with_a_photo(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    ravi: str,
    problem: Problem,
    reason: str,
) -> None:
    answer = face_punch(db_client, device, person=1, problem=problem).json()

    assert answer["decision"] == "rejected" and answer["reason_code"] == reason
    assert answer["employee"] is None
    snapshot = db_session.scalars(select(PunchSnapshot)).one()
    assert snapshot.reason == "face_rejected" and snapshot.width == 320
    assert (snapshot.expires_at - snapshot.taken_at) == timedelta(days=60)


def test_a_turn_the_wrong_way_fails_liveness(
    db_client: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    given = challenge(db_client, device)
    wrong = -turn_yaw(given["challenge"])
    frames = [frame(1), frame(1, yaw=wrong, role="turn")]

    answer = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"]).json()

    assert answer["reason_code"] == "LIVENESS_FAILED" and answer["details"]["retry_allowed"]


def test_no_turn_at_all_or_a_turned_frontal_frame_fails_liveness(
    db_client: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    given = challenge(db_client, device)
    flat = [frame(1), frame(1, yaw=2, role="turn")]
    assert (
        face_punch(db_client, device, 1, frames=flat, nonce=given["challenge_nonce"]).json()[
            "reason_code"
        ]
        == "LIVENESS_FAILED"
    )

    again = challenge(db_client, device)
    turned_front = [frame(1, yaw=20), frame(1, yaw=turn_yaw(again["challenge"]), role="turn")]
    answer = face_punch(db_client, device, 1, frames=turned_front, nonce=again["challenge_nonce"])
    assert answer.json()["reason_code"] == "LIVENESS_FAILED"


def test_another_face_in_the_turn_frame_is_inconsistent(
    db_client: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    answer = face_punch(db_client, device, person=1, turn_person=7).json()

    assert answer["reason_code"] == "FACE_INCONSISTENT"


def test_no_face_and_unreadable_frames(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    assert face_punch(db_client, device, person=0).json()["reason_code"] == "NO_FACE"

    broken = [{"role": "frontal", "jpeg": "bm90IGEgcGljdHVyZQ=="}, frame(1, yaw=25, role="turn")]
    answer = face_punch(db_client, device, 1, frames=broken).json()
    assert answer["reason_code"] == "FRAMES_INVALID"
    reasons = {punch.reason_codes[0]: punch.id for punch in db_session.scalars(select(Punch)).all()}
    snapshot_punches = set(db_session.scalars(select(PunchSnapshot.punch_id)).all())
    assert reasons["FRAMES_INVALID"] not in snapshot_punches  # no usable picture: no photo


def test_a_stranger_is_not_recognised(
    db_client: TestClient, db_session: Session, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    answer = face_punch(db_client, device, person=7).json()

    assert answer["reason_code"] == "FACE_NOT_RECOGNISED" and answer["employee"] is None
    assert db_session.scalars(select(PunchSnapshot)).one().reason == "face_rejected"


def test_a_leaver_is_not_recognised_any_more(
    db_client: TestClient, boss: TestClient, device: Device, kiosk: KioskDevice, ravi: str
) -> None:
    boss.post(
        f"/api/v1/employees/{ravi}/mark-left",
        json={"left_on": today_ist().isoformat(), "reason": "Resigned"},
    )

    assert face_punch(db_client, device, person=1).json()["reason_code"] == "FACE_NOT_RECOGNISED"


# --- Code path (AC-13 to AC-16) -----------------------------------------------------------------


@pytest.fixture
def look_alikes(boss: TestClient, k134: PlantIds) -> tuple[str, str]:
    """Persons 1 and 2 at K134: person 14 looks equally like both (no margin: unsure)."""
    first = new_employee(boss, k134, code="2001")
    enrol(boss, first, person=1)
    second = new_employee(boss, k134, code="2002")
    enrol(boss, second, person=2)
    return first, second


def test_an_unsure_face_asks_for_the_code_and_keeps_a_photo(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
) -> None:
    answer = face_punch(db_client, device, person=14).json()

    assert answer["decision"] == "needs_code" and answer["reason_code"] == "NEED_EMPLOYEE_CODE"
    assert answer["employee"] is None
    assert len(answer["code_entry"]["token"]) == 43 and answer["code_entry"]["tries_left"] == 2
    assert "score" not in json.dumps(answer)
    punch = db_session.scalars(select(Punch)).one()
    assert punch.decision == "needs_code" and punch.employee_id is None
    assert db_session.scalars(select(PunchSnapshot)).one().reason == "face_code"
    pending = db_session.scalars(select(FacePendingMatch)).one()
    assert pending.token_sha256 != answer["code_entry"]["token"]
    with pytest.raises(FaceDecryptionError):  # bound to this pending row and kiosk only
        open_vector(
            SealedVector(pending.nonce, pending.ciphertext),
            pending_match_binding(uuid.uuid4(), pending.kiosk_id),
            face_key(),
        )


def test_the_right_code_is_accepted_by_code(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
) -> None:
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]

    answer = code_try(db_client, device, token, " 2001 ").json()

    assert (answer["decision"], answer["direction"]) == ("accepted", "in")
    assert answer["employee"]["employee_code"] == "2001"
    origin, final = sorted(db_session.scalars(select(Punch)).all(), key=lambda p: p.decision)
    assert final.decision == "needs_code" and origin.decision == "accepted"
    assert origin.match_mode == "code" and origin.follows_punch_id == final.id
    assert origin.claimed_employee_id == origin.employee_id == uuid.UUID(look_alikes[0])
    assert db_session.scalars(select(FacePendingMatch)).all() == []


def test_a_wrong_code_twice_ends_not_recognised_with_the_claimed_employee(
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
    boss: TestClient,
    k134: PlantIds,
) -> None:
    ravi = new_employee(boss, k134, code="1043")
    enrol(boss, ravi, person=5)  # another face than the one at the gate
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]

    started = time.monotonic()
    first = code_try(db_client, device, token, "1043").json()  # Ravi: another face
    assert time.monotonic() - started >= 0.3
    assert first["decision"] == "needs_code" and first["reason_code"] == "CODE_NOT_MATCHED"
    assert first["code_entry"]["tries_left"] == 1
    assert len(db_session.scalars(select(Punch)).all()) == 1  # no row for a try in between

    second = code_try(db_client, device, token, "1043").json()

    assert second["decision"] == "rejected" and second["reason_code"] == "FACE_NOT_RECOGNISED"
    final = db_session.scalars(select(Punch).where(Punch.decision == "rejected")).one()
    assert final.claimed_employee_id == uuid.UUID(ravi) and final.employee_id is None
    assert db_session.scalars(select(FacePendingMatch)).all() == []


def test_an_unknown_code_gets_exactly_the_same_answers(
    db_client: TestClient, device: Device, kiosk: KioskDevice, look_alikes: tuple[str, str]
) -> None:
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]

    first = code_try(db_client, device, token, "NOBODY").json()
    second = code_try(db_client, device, token, "NOBODY").json()

    assert (first["reason_code"], first["code_entry"]["tries_left"]) == ("CODE_NOT_MATCHED", 1)
    assert second["reason_code"] == "FACE_NOT_RECOGNISED"


def test_a_retry_of_the_same_code_try_does_not_use_another_try(
    db_client: TestClient, device: Device, kiosk: KioskDevice, look_alikes: tuple[str, str]
) -> None:
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]
    try_id = str(uuid.uuid4())

    first = code_try(db_client, device, token, "NOBODY", client_punch_id=try_id).json()
    retry = code_try(db_client, device, token, "NOBODY", client_punch_id=try_id).json()

    assert first["code_entry"]["tries_left"] == retry["code_entry"]["tries_left"] == 1
    assert code_try(db_client, device, token, "2001").json()["decision"] == "accepted"


def test_an_old_or_foreign_code_token_is_expired(
    db_client: TestClient,
    db_session: Session,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
) -> None:
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]
    other_device = Device()
    make_active_kiosk(db_session, k134, other_device, name="Back gate")

    foreign = code_try(db_client, other_device, token, "2001").json()
    assert foreign["reason_code"] == "CODE_ENTRY_EXPIRED"

    pending = db_session.scalars(select(FacePendingMatch)).one()
    pending.expires_at = utc_now() - timedelta(seconds=1)
    db_session.commit()
    expired = code_try(db_client, device, token, "2001").json()
    assert expired["reason_code"] == "CODE_ENTRY_EXPIRED"
    assert db_session.scalars(select(FacePendingMatch)).all() == []


def test_the_right_code_of_another_plant_is_wrong_plant(
    db_client: TestClient,
    db_session: Session,
    boss: TestClient,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    twin = new_employee(boss, tp1, code="3001")
    overridden = enrol(boss, twin, person=1, duplicate_override_reason="Twin of 2001, checked")
    assert overridden.status_code == 201
    token = face_punch(db_client, device, person=14).json()["code_entry"]["token"]

    answer = code_try(db_client, device, token, "3001").json()

    assert answer["reason_code"] == "WRONG_PLANT"
    assert answer["message_key"] == "kiosk.punch.WRONG_PLANT_FACE" and answer["employee"] is None


def test_the_11th_code_try_in_a_minute_is_refused(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    for _ in range(10):
        code_try_limiter.record(str(kiosk.id))

    assert code_try(db_client, device, "x" * 43, "2001").status_code == 429


def test_a_lost_needs_code_answer_gets_a_fresh_working_token(
    db_client: TestClient, device: Device, kiosk: KioskDevice, look_alikes: tuple[str, str]
) -> None:
    given = challenge(db_client, device)
    yaw = turn_yaw(given["challenge"])
    frames = [frame(14), frame(14, yaw=yaw, role="turn")]
    punch_id = str(uuid.uuid4())
    first = face_punch(
        db_client,
        device,
        14,
        frames=frames,
        nonce=given["challenge_nonce"],
        client_punch_id=punch_id,
    ).json()

    retry = face_punch(
        db_client,
        device,
        14,
        frames=frames,
        nonce=given["challenge_nonce"],
        client_punch_id=punch_id,
    ).json()

    assert retry["punch_id"] == first["punch_id"] and retry["decision"] == "needs_code"
    assert retry["code_entry"]["token"] != first["code_entry"]["token"]
    assert code_try(db_client, device, retry["code_entry"]["token"], "2001").json()["decision"] == (
        "accepted"
    )


# --- Request checks (AC-27 to AC-29) ------------------------------------------------------------


@pytest.mark.parametrize(
    "frames",
    [
        [frame(1), frame(1, role="turn"), frame(1), frame(1), frame(1)],  # 5 frames
        [frame(1), frame(1)],  # no turn frame
        [frame(1, role="turn"), frame(1)],  # the first is not frontal
        [frame(1)],  # only one
    ],
)
def test_a_wrong_set_of_frames_is_a_validation_error(
    db_client: TestClient, device: Device, kiosk: KioskDevice, frames: list[dict]
) -> None:
    response = face_punch(db_client, device, 1, frames=frames, nonce="n" * 22)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_a_face_body_over_384_kb_is_refused(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    huge = base64.b64encode(b"\xff\xd8\xff" + b"0" * 300_000).decode()
    body = {
        "client_punch_id": str(uuid.uuid4()),
        "method": "face",
        "challenge_nonce": "n" * 22,
        "frames": [{"role": "frontal", "jpeg": huge}, frame(1, yaw=25, role="turn")],
    }

    response = signed_post(db_client, device, PUNCH, body)

    assert response.status_code == 413


def test_face_punches_wait_for_the_engine_while_card_punches_do_not(
    db_app: FastAPI, db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    db_app.dependency_overrides[get_face_engine] = lambda: FaceEngine(FakeFaceModels)  # loading

    response = signed_post(db_client, device, CHALLENGE, {})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FACE_SERVICE_UNAVAILABLE"
    health = db_client.get("/api/v1/health").json()
    assert health["face"] == {"state": "loading", "model_pack": None, "antispoof_model": None}


def test_a_busy_face_worker_answers_busy_and_keeps_the_challenge(
    db_app: FastAPI,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    ravi: str,
) -> None:
    busy_engine = FaceEngine(FakeFaceModels, max_waiting=1, max_wait_seconds=0.05)
    busy_engine.load_now()
    db_app.dependency_overrides[get_face_engine] = lambda: busy_engine
    given = challenge(db_client, device)
    frames = [frame(1), frame(1, yaw=turn_yaw(given["challenge"]), role="turn")]
    release, started = threading.Event(), threading.Event()

    def hold(models: object) -> None:
        started.set()
        release.wait(timeout=5)

    holder = threading.Thread(target=busy_engine.run, args=(hold,))
    holder.start()
    started.wait(timeout=5)
    busy = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"])
    release.set()
    holder.join(timeout=5)

    assert busy.status_code == 503 and busy.json()["error"]["code"] == "FACE_SERVICE_BUSY"
    assert db_session.scalars(select(PunchChallenge)).one().used_at is None
    again = face_punch(db_client, device, 1, frames=frames, nonce=given["challenge_nonce"])
    assert again.json()["decision"] == "accepted"


def test_the_health_check_shows_a_ready_face_engine(db_client: TestClient) -> None:
    assert db_client.get("/api/v1/health").json()["face"] == {
        "state": "ready",
        "model_pack": "fake",
        "antispoof_model": "fake",
    }


# --- Nothing secret in the logs (AC-26) ---------------------------------------------------------


def test_frames_tokens_and_codes_never_reach_the_logs(
    db_client: TestClient,
    device: Device,
    kiosk: KioskDevice,
    look_alikes: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    sent = frame(14)
    with caplog.at_level(logging.DEBUG):
        answer = face_punch(db_client, device, 14, frames=[sent, frame(14, yaw=25, role="turn")])
        token = (answer.json().get("code_entry") or {}).get("token", "no-token")
        code_try(db_client, device, token, "SECRETCODE")

    text = caplog.text + json.dumps([getattr(r, "fields", None) for r in caplog.records])
    assert sent["jpeg"][:40] not in text
    assert token not in text
    assert "SECRETCODE" not in text
