"""The phone face punch (M4b spec §5.3, §7 rules 10, 12, 13, 14, 17; AC-20 to AC-29, AC-41b, AC-49
punch part). Real PostgreSQL, fake face engine (person 1 is F-201's face, person 2 someone else).
Every time is pinned (time-machine) to Monday 02/11/2026 IST, as in the spec."""

import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.face.fake_engine import Problem
from app.modules.org.models import Geofence
from app.modules.punches.models import Punch, PunchChallenge, PunchSnapshot
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.conftest import TEST_ORIGIN, clear_cached_settings
from tests.face_helpers import frame, set_privacy
from tests.kiosk_helpers import GATE_LOCATION, Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    FAR_AWAY,
    PHONE,
    People,
    make_people,
    metres_north,
    phone_face_punch,
    signed_in_phone,
    switch_phone,
    turn_yaw,
)
from tests.test_face_punch_api import face_punch

MONDAY = date(2026, 11, 2)
DEMO2_CENTRE = {"lat": 19.9000, "lon": 75.3000, "accuracy_m": 10.0, "age_s": 2}

# These tests are about the phone punch, not about the early-OUT alert of the gate (M5).
pytestmark = pytest.mark.usefixtures("early_out_alert_off")


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
    switch_phone(boss, found.face_id)
    switch_phone(boss, found.qr_id)
    return found


@pytest.fixture
def phone(db_app: FastAPI, db_session: Session, people: People) -> TestClient:
    return signed_in_phone(db_app, db_session, people.face_id, "F-201")


def punches(session: Session) -> list[Punch]:
    session.expire_all()
    return list(session.scalars(select(Punch).order_by(Punch.server_received_at)))


def only_punch(session: Session) -> Punch:
    (found,) = punches(session)
    return found


def allow_outside_work(boss: TestClient, employee_id: str, until: str | None = None) -> None:
    body = {"allowed": True, "reason": "Site visits"} | ({"until": until} if until else {})
    answer = boss.put(f"/api/v1/employees/{employee_id}/phone/outside-work", json=body)
    assert answer.status_code == 200, answer.text


def second_plant(boss: TestClient, session: Session) -> PlantIds:
    """DEMO2 with its own fence, far from DEMO1's (DEMO2 is at 19.90 N, 75.30 E)."""
    plant = create_plant(boss, session, "DEMO2")
    session.add(
        Geofence(
            plant_id=uuid.UUID(plant.id),
            version=1,
            shape="circle",
            geojson={"type": "Point", "coordinates": [75.3000, 19.9000]},
            radius_m=200,
            buffer_m=25,
            is_current=True,
        )
    )
    session.commit()
    return plant


def review_body(action: str, reason: str, direction: str) -> dict:
    return {
        "action": action,
        "reason": reason,
        "direction": direction,
        "expected_latest_review_id": None,
    }


# --- AC-20: inside the fence ---


def test_ac_20_a_face_punch_inside_the_fence_is_accepted_without_a_photo(
    db_session: Session, phone: TestClient, people: People
) -> None:
    with frozen_at(ist(MONDAY, 6, 55)):
        answer = phone_face_punch(phone, person=1, location=metres_north(30))

    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert (body["decision"], body["direction"], body["reason_code"]) == ("accepted", "in", None)
    assert body["outside_plant"] is False
    punch = only_punch(db_session)
    assert (punch.channel, punch.method, punch.match_mode) == ("phone", "face", "one_to_one")
    assert punch.kiosk_id is None and str(punch.employee_id) == people.face_id
    assert punch.phone_session_id is not None and punch.claimed_employee_id is None
    assert punch.location_plant_id == punch.plant_id
    assert punch.match_score is not None and float(punch.match_score) > 0.99
    assert db_session.scalars(select(PunchSnapshot)).all() == []  # accepted: no image kept


def test_a_retry_with_the_same_id_gets_the_stored_answer(
    db_session: Session, phone: TestClient
) -> None:
    same = str(uuid.uuid4())
    with frozen_at(ist(MONDAY, 7, 10)):
        first = phone_face_punch(phone, person=1, client_punch_id=same)
        again = phone_face_punch(phone, person=1, client_punch_id=same)

    assert first.json() == again.json()
    assert len(punches(db_session)) == 1


# --- AC-21: outside the fence, outside work OFF ---


def test_ac_21_outside_the_fence_is_refused_before_any_face_work_and_can_be_approved(
    boss: TestClient, db_session: Session, phone: TestClient, people: People
) -> None:
    with frozen_at(ist(MONDAY, 8, 0)):
        answer = phone_face_punch(phone, person=1, location=FAR_AWAY)

    assert answer.json()["decision"] == "rejected"
    assert answer.json()["reason_code"] == "OUTSIDE_GEOFENCE"
    punch = only_punch(db_session)
    assert punch.employee_id is None and str(punch.claimed_employee_id) == people.face_id
    assert punch.match_mode is None and punch.match_score is None  # the face worker did not run
    assert db_session.scalars(select(PunchChallenge)).one().used_at is None
    assert punch.geofence_distance_m is not None and float(punch.geofence_distance_m) > 1000
    approved = boss.post(
        f"/api/v1/punches/{punch.id}/reviews",
        json=review_body("approve", "Checked with the plant head", "in"),
    )
    assert approved.status_code == 201, approved.text


# --- AC-22: outside work, flagged OUTSIDE_PLANT ---


def test_ac_22_outside_work_gives_a_flagged_outside_plant_punch_that_counts(
    boss: TestClient, db_session: Session, phone: TestClient, people: People
) -> None:
    allow_outside_work(boss, people.face_id)
    with frozen_at(ist(MONDAY, 7, 0)):
        assert phone_face_punch(phone, person=1).json()["direction"] == "in"
    with frozen_at(ist(MONDAY, 18, 30)):
        answer = phone_face_punch(phone, person=1, location=FAR_AWAY)

    body = answer.json()
    assert (body["decision"], body["direction"], body["outside_plant"]) == ("accepted", "out", True)
    assert body["reason_code"] is None  # the person is not told the flag code
    out = punches(db_session)[-1]
    assert out.decision == "flagged" and out.reason_codes == ["OUTSIDE_PLANT"]
    assert out.location_plant_id is None and out.lat is not None  # the position is stored
    listed = boss.get("/api/v1/reviews").json()["items"]
    assert str(out.id) in {item["punch"]["id"] for item in listed}


def test_ac_22_a_plant_head_sees_the_tag_but_no_coordinates(
    boss: TestClient,
    db_app: FastAPI,
    db_session: Session,
    phone: TestClient,
    people: People,
    demo1: PlantIds,
) -> None:
    allow_outside_work(boss, people.face_id)
    with frozen_at(ist(MONDAY, 9, 0)):
        phone_face_punch(phone, person=1, location=FAR_AWAY)
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head1")
    user = db_session.scalars(select(User).where(User.username == "head1")).one()
    set_user_plant(db_session, user, uuid.UUID(demo1.id))
    db_session.commit()

    items = head.get("/api/v1/punches", params={"date": MONDAY.isoformat()}).json()["items"]

    assert items and "OUTSIDE_PLANT" in items[0]["reason_codes"]
    detail = head.get(f"/api/v1/punches/{items[0]['id']}").json()
    assert detail.get("lat") is None and detail.get("lon") is None


# --- AC-23, AC-24 ---


def test_ac_23_inside_the_margin_is_accepted_and_flagged_at_the_edge(
    db_session: Session, phone: TestClient
) -> None:
    with frozen_at(ist(MONDAY, 7, 5)):
        answer = phone_face_punch(phone, person=1, location=metres_north(215))

    assert answer.json()["decision"] == "accepted" and answer.json()["outside_plant"] is False
    punch = only_punch(db_session)
    assert punch.decision == "flagged" and punch.reason_codes == ["LOCATION_AT_EDGE"]


@pytest.mark.parametrize(
    ("location", "code"),
    [
        (GATE_LOCATION | {"accuracy_m": 80.0}, "GPS_ACCURACY_TOO_LOW"),
        (GATE_LOCATION | {"age_s": 90}, "LOCATION_REQUIRED"),
        (GATE_LOCATION | {"age_s": None}, "LOCATION_REQUIRED"),
        (None, "LOCATION_REQUIRED"),
    ],
)
def test_ac_24_a_weak_or_old_reading_is_refused(
    db_session: Session, phone: TestClient, location: dict | None, code: str
) -> None:
    with frozen_at(ist(MONDAY, 9, 0)):
        answer = phone_face_punch(phone, person=1, location=location)

    assert answer.json()["reason_code"] == code
    assert only_punch(db_session).decision == "rejected"


# --- AC-25, AC-26, AC-27 ---


def test_ac_25_another_persons_face_is_refused_and_a_photo_is_kept_encrypted(
    db_session: Session, phone: TestClient, snapshot_folder: Path
) -> None:
    with frozen_at(ist(MONDAY, 9, 0)):
        answer = phone_face_punch(phone, person=2)

    assert answer.json()["reason_code"] == "FACE_NOT_RECOGNISED"
    punch = only_punch(db_session)
    assert punch.employee_id is None and punch.claimed_employee_id is not None
    snapshot = db_session.scalars(select(PunchSnapshot)).one()
    assert snapshot.reason == "phone_face_rejected" and snapshot.state == "stored"
    stored = next(snapshot_folder.rglob("*.bin"))
    assert not stored.read_bytes().startswith(b"\xff\xd8")  # not a plain JPEG: AES-256-GCM


def test_ac_26_a_printed_photo_a_foreign_challenge_and_a_used_challenge_are_refused(
    db_app: FastAPI, db_session: Session, phone: TestClient, people: People
) -> None:
    with frozen_at(ist(MONDAY, 9, 0)):
        spoof = phone_face_punch(phone, person=1, problem=Problem.SPOOF)
        assert spoof.json()["reason_code"] == "SPOOF_SUSPECTED"
        asked = phone.post(f"{PHONE}/punch/challenge").json()
        other_phone = signed_in_phone(db_app, db_session, people.face_id, "F-201")
        # a challenge the first phone asked for is not the second sign-in's
        foreign = phone_face_punch(other_phone, person=1, nonce=asked["challenge_nonce"])
        assert foreign.json()["reason_code"] == "CHALLENGE_INVALID"
        # one phone at a time: the first phone was signed out by the second sign-in
        assert phone.post(f"{PHONE}/punch/challenge").status_code == 401
        given = other_phone.post(f"{PHONE}/punch/challenge").json()
        body = {
            "client_punch_id": str(uuid.uuid4()),
            "challenge_nonce": given["challenge_nonce"],
            "frames": [
                frame(1),
                frame(1, yaw=turn_yaw(given["challenge"]), role="turn"),
                frame(1),
            ],
            "location": GATE_LOCATION,
        }
        assert other_phone.post(f"{PHONE}/punch/face", json=body).json()["decision"] == "accepted"
        body["client_punch_id"] = str(uuid.uuid4())
        reuse = other_phone.post(f"{PHONE}/punch/face", json=body)
        assert reuse.json()["reason_code"] == "CHALLENGE_INVALID"


def test_ac_27_a_face_employee_without_a_template_cannot_even_ask(
    boss: TestClient, db_session: Session, phone: TestClient, people: People
) -> None:
    deleted = boss.post(
        f"/api/v1/employees/{people.face_id}/face/template/delete",
        json={"reason": "Left the company"},
    )
    assert deleted.status_code == 200, deleted.text

    answer = phone.post(f"{PHONE}/punch/challenge")

    assert answer.status_code == 409
    assert answer.json()["error"]["code"] == "PHONE_FACE_NOT_READY"
    assert punches(db_session) == []


# --- AC-28: the usual rules across the gate and the phone ---


def test_ac_28_the_gate_rules_apply_to_the_phone_too(
    boss: TestClient,
    db_session: Session,
    db_app: FastAPI,
    phone: TestClient,
    people: People,
    demo1: PlantIds,
) -> None:
    device = Device()
    make_active_kiosk(db_session, demo1, device)
    gate = TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})
    with frozen_at(ist(MONDAY, 6, 58, 30)):  # F-201 INs at the gate G1
        assert face_punch(gate, device, person=1).json()["decision"] == "accepted"
    with frozen_at(ist(MONDAY, 7, 0)):
        assert phone_face_punch(phone, person=1).json()["reason_code"] == "COOLDOWN_ACTIVE"
    with frozen_at(ist(MONDAY, 7, 10)):
        assert phone_face_punch(phone, person=1).json()["reason_code"] == "OUT_TOO_SOON"
    with frozen_at(ist(MONDAY, 19, 5)):
        out = phone_face_punch(phone, person=1)
        assert (out.json()["decision"], out.json()["direction"]) == ("accepted", "out")
    with frozen_at(ist(MONDAY, 19, 40)):
        closed = phone_face_punch(phone, person=1)
        assert closed.json()["reason_code"] == "SHIFT_ALREADY_CLOSED"
    refused = punches(db_session)[-1]
    # Approvable: the row names the employee. "No new evidence": no photo is kept for it.
    assert str(refused.employee_id) == people.face_id
    assert db_session.scalars(select(PunchSnapshot)).all() == []
    approve = boss.post(
        f"/api/v1/punches/{refused.id}/reviews",
        json=review_body("approve", "He came back for the night", "in"),
    )
    assert approve.status_code == 201, approve.text


# --- AC-29: a phone punch far away, then the gate ---


def test_ac_29_the_gate_punch_after_a_far_phone_punch_is_flagged_impossible_travel(
    boss: TestClient,
    db_session: Session,
    db_app: FastAPI,
    phone: TestClient,
    people: People,
    demo1: PlantIds,
) -> None:
    allow_outside_work(boss, people.face_id)
    device = Device()
    make_active_kiosk(db_session, demo1, device)
    gate = TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})
    pune = {"lat": 18.5204, "lon": 73.8567, "accuracy_m": 10.0, "age_s": 2}  # about 230 km away
    with frozen_at(ist(MONDAY, 10, 0)):
        assert phone_face_punch(phone, person=1, location=pune).json()["outside_plant"] is True
    with frozen_at(ist(MONDAY, 10, 30)):
        assert face_punch(gate, device, person=1).json()["decision"] == "accepted"

    phone_row, gate_row = punches(db_session)
    assert gate_row.decision == "flagged" and "IMPOSSIBLE_TRAVEL" in gate_row.reason_codes
    assert gate_row.related_punch_id == phone_row.id


# --- AC-41b: standing inside another plant's fence ---


def test_ac_41b_inside_another_plants_fence_is_accepted_without_a_flag(
    boss: TestClient, db_session: Session, phone: TestClient, people: People
) -> None:
    demo2 = second_plant(boss, db_session)
    allow_outside_work(boss, people.face_id)
    with frozen_at(ist(MONDAY, 8, 0)):
        answer = phone_face_punch(phone, person=1, location=DEMO2_CENTRE)

    assert answer.json()["decision"] == "accepted" and answer.json()["outside_plant"] is False
    punch = only_punch(db_session)
    assert punch.decision == "accepted" and punch.reason_codes == []
    assert str(punch.location_plant_id) == demo2.id and str(punch.plant_id) != demo2.id
    fence = db_session.get(Geofence, punch.geofence_id)
    assert fence is not None and str(fence.plant_id) == demo2.id
    assert punch.geofence_distance_m is not None and float(punch.geofence_distance_m) == 0
    listed = boss.get("/api/v1/reviews").json()["items"]
    assert str(punch.id) not in {item["punch"]["id"] for item in listed}


def test_ac_41b_with_outside_work_off_the_same_punch_is_outside_geofence(
    boss: TestClient, db_session: Session, phone: TestClient
) -> None:
    second_plant(boss, db_session)
    with frozen_at(ist(MONDAY, 8, 0)):
        answer = phone_face_punch(phone, person=1, location=DEMO2_CENTRE)

    assert answer.json()["reason_code"] == "OUTSIDE_GEOFENCE"


# --- AC-49 (punch part): the "until" date ---


def test_ac_49_the_until_day_counts_whole_and_the_next_day_it_is_off(
    boss: TestClient, phone: TestClient, people: People
) -> None:
    last_day = today_ist() + timedelta(days=1)
    allow_outside_work(boss, people.face_id, until=last_day.isoformat())
    with frozen_at(ist(last_day, 23, 50)):
        inside_last_day = phone_face_punch(phone, person=1, location=FAR_AWAY)
    assert inside_last_day.json()["outside_plant"] is True
    with frozen_at(ist(last_day + timedelta(days=1), 0, 10)):
        next_day = phone_face_punch(phone, person=1, location=FAR_AWAY)
    assert next_day.json()["reason_code"] == "OUTSIDE_GEOFENCE"


# --- Request-level checks: no row ---


def test_the_notice_must_be_accepted_first(
    db_app: FastAPI, db_session: Session, people: People
) -> None:
    fresh = signed_in_phone(db_app, db_session, people.face_id, "F-201", notice=False)

    answer = fresh.post(f"{PHONE}/punch/challenge")

    assert answer.status_code == 428
    assert answer.json()["error"]["code"] == "PHONE_NOTICE_REQUIRED"


def test_a_qr_worker_cannot_use_the_face_path_and_a_face_employee_not_the_code_path(
    db_app: FastAPI, db_session: Session, phone: TestClient, people: People
) -> None:
    worker = signed_in_phone(db_app, db_session, people.qr_id, "Q-301")

    assert worker.post(f"{PHONE}/punch/challenge").json()["error"]["code"] == "EMPLOYEE_NOT_FACE"
    code_path = phone.post(
        f"{PHONE}/punch/gate-code",
        json={"client_punch_id": str(uuid.uuid4()), "gate_code": "UPG1.X", "photo_jpeg": None},
    )
    assert code_path.status_code == 403
    assert code_path.json()["error"]["code"] == "EMPLOYEE_NOT_QR"
    assert db_session.scalars(select(Punch)).all() == []


def test_ten_challenges_a_minute_then_too_many_requests(phone: TestClient) -> None:
    with frozen_at(ist(MONDAY, 9, 0)):
        answers = [phone.post(f"{PHONE}/punch/challenge").status_code for _ in range(11)]

    assert answers[:10] == [200] * 10 and answers[10] == 429


def test_a_bad_frame_set_is_a_request_error_and_no_cookie_is_refused(
    phone: TestClient, db_app: FastAPI
) -> None:
    bad = phone.post(
        f"{PHONE}/punch/face",
        json={
            "client_punch_id": str(uuid.uuid4()),
            "challenge_nonce": "x",
            "frames": [frame(1, role="turn"), frame(1, role="turn")],
            "location": GATE_LOCATION,
        },
    )
    assert bad.status_code == 422
    nobody = TestClient(db_app, base_url="https://testserver", headers={"Origin": TEST_ORIGIN})
    assert nobody.post(f"{PHONE}/punch/challenge").status_code == 401


def test_switching_phone_punching_off_ends_the_session_for_the_next_punch(
    boss: TestClient, phone: TestClient, people: People
) -> None:
    assert switch_phone(boss, people.face_id, on=False).status_code == 200

    answer = phone.post(f"{PHONE}/punch/challenge")

    assert answer.json()["error"]["code"] == "PHONE_PUNCH_OFF"
