"""The early-OUT alert on the phone (decision 0036 lines 77 and 88): a phone OUT before the shift
end is not stored at once; the phone gets the time that is left and a token, and Agree stores the
OUT with the early-OUT mark. Face punch and gate-code punch, real endpoints, real PostgreSQL, every
time pinned (time-machine) to Monday 02/11/2026. The plant's default shift is 07:00-19:00 with a
half day of 4 hours."""

import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import TEST_ORIGIN, clear_cached_settings
from tests.face_helpers import set_privacy
from tests.kiosk_helpers import GATE_LOCATION, Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.phone_api_helpers import (
    FAR_AWAY,
    PHONE,
    People,
    make_people,
    phone_face_punch,
    signed_in_phone,
    switch_phone,
)
from tests.test_m4b_gate_code import ask_code, selfie, send_code

MONDAY = date(2026, 11, 2)
CONFIRM = f"{PHONE}/punch/early-out/confirm"


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
def face_phone(db_app: FastAPI, db_session: Session, people: People) -> TestClient:
    return signed_in_phone(db_app, db_session, people.face_id, "F-201")


@pytest.fixture
def worker_phone(db_app: FastAPI, db_session: Session, people: People) -> TestClient:
    return signed_in_phone(db_app, db_session, people.qr_id, "Q-301")


@pytest.fixture
def g1(db_session: Session, demo1: PlantIds) -> Device:
    device = Device()
    make_active_kiosk(db_session, demo1, device, name="G1")
    return device


@pytest.fixture
def gate(db_app: FastAPI) -> TestClient:
    return TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})


def punches(session: Session) -> list[Punch]:
    session.expire_all()
    return list(session.scalars(select(Punch).order_by(Punch.server_received_at)))


def agree(
    phone: TestClient, answer: dict, *, location: dict | None = GATE_LOCATION, photo: bool = False
):
    """Agree: the token and the punch id of the alert, a fresh location (and the selfie again)."""
    prompt = answer["early_out"]
    return phone.post(
        CONFIRM,
        json={
            "client_punch_id": prompt["client_punch_id"],
            "token": prompt["token"],
            "location": location,
            "photo_jpeg": selfie() if photo else None,
        },
    )


def face_in_at_eight(phone: TestClient) -> None:
    with frozen_at(ist(MONDAY, 8, 0)):
        answer = phone_face_punch(phone, person=1)
    assert (answer.json()["decision"], answer.json()["direction"]) == ("accepted", "in")


# --- Face punch ---


def test_a_face_out_before_the_half_shift_asks_first_and_stores_nothing(
    db_session: Session, face_phone: TestClient
) -> None:
    face_in_at_eight(face_phone)

    with frozen_at(ist(MONDAY, 10, 10)):
        answer = phone_face_punch(face_phone, person=1)

    body = answer.json()
    assert answer.status_code == 200, answer.text
    assert (body["decision"], body["direction"], body["punch_id"]) == (
        "needs_confirmation",
        "out",
        None,
    )
    prompt = body["early_out"]
    assert prompt["tier"] == "before_half"
    assert prompt["half_remaining_min"] == 110  # the half shift counts from 08:00: complete 12:00
    assert prompt["full_remaining_min"] == 530  # the shift ends at 19:00
    assert len(punches(db_session)) == 1  # only the IN


def test_agree_stores_the_out_with_the_mark_and_a_retry_is_idempotent(
    db_session: Session, face_phone: TestClient, people: People
) -> None:
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        asked = phone_face_punch(face_phone, person=1).json()

    with frozen_at(ist(MONDAY, 10, 11)):
        agreed = agree(face_phone, asked)
        again = agree(face_phone, asked)  # the answer was lost: Agree is sent again

    assert agreed.status_code == 200, agreed.text
    body = agreed.json()
    assert (body["decision"], body["direction"], body["reason_code"]) == ("accepted", "out", None)
    assert again.json() == body
    stored = punches(db_session)
    assert len(stored) == 2
    out = stored[1]
    assert str(out.id) == body["punch_id"] and out.early_out_mark == "EARLY_OUT_CONFIRMED"
    assert (out.channel, out.method, out.decision) == ("phone", "face", "accepted")
    assert out.reason_codes == [] and str(out.employee_id) == people.face_id  # a mark, not a flag
    assert out.match_score is not None and out.challenge is not None  # the held facts are kept


def test_cancel_saves_nothing_and_the_person_can_leave_after_the_end(
    db_session: Session, face_phone: TestClient
) -> None:
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        phone_face_punch(face_phone, person=1)  # the alert; the phone sends nothing more: Cancel
    assert len(punches(db_session)) == 1

    with frozen_at(ist(MONDAY, 19, 5)):
        later = phone_face_punch(face_phone, person=1).json()

    assert (later["decision"], later["direction"]) == ("accepted", "out")
    assert later["early_out"] is None
    assert punches(db_session)[-1].early_out_mark is None


def test_after_the_half_shift_but_before_the_end_the_softer_alert_is_shown(
    face_phone: TestClient,
) -> None:
    face_in_at_eight(face_phone)

    with frozen_at(ist(MONDAY, 15, 25)):
        prompt = phone_face_punch(face_phone, person=1).json()["early_out"]

    assert prompt["tier"] == "before_end"
    assert prompt["half_remaining_min"] is None
    assert prompt["full_remaining_min"] == 215


def test_an_in_never_asks(face_phone: TestClient, db_session: Session) -> None:
    with frozen_at(ist(MONDAY, 8, 0)):
        answer = phone_face_punch(face_phone, person=1).json()

    assert (answer["decision"], answer["direction"], answer["early_out"]) == (
        "accepted",
        "in",
        None,
    )
    assert punches(db_session)[0].early_out_mark is None


def test_a_token_is_for_one_punch_and_ninety_seconds(face_phone: TestClient) -> None:
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        asked = phone_face_punch(face_phone, person=1).json()

    other_punch = asked | {"early_out": asked["early_out"] | {"client_punch_id": str(uuid.uuid4())}}
    with frozen_at(ist(MONDAY, 10, 11)):
        wrong_id = agree(face_phone, other_punch)
    with frozen_at(ist(MONDAY, 10, 12)):
        too_late = agree(face_phone, asked)

    assert wrong_id.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"
    assert too_late.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"


def test_another_phone_cannot_use_the_token(
    db_app: FastAPI, db_session: Session, face_phone: TestClient, people: People
) -> None:
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        asked = phone_face_punch(face_phone, person=1).json()
        second_phone = signed_in_phone(db_app, db_session, people.face_id, "F-201")
        answer = agree(second_phone, asked)

    assert answer.json()["error"]["code"] == "EARLY_OUT_TOKEN_INVALID"


def test_agree_never_lets_a_refused_punch_through(
    db_session: Session, face_phone: TestClient
) -> None:
    """The place is judged again at Agree: from far away the OUT is refused and no OUT is saved."""
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        asked = phone_face_punch(face_phone, person=1).json()

    with frozen_at(ist(MONDAY, 10, 11)):
        agreed = agree(face_phone, asked, location=FAR_AWAY)

    body = agreed.json()
    assert (body["decision"], body["direction"]) == ("rejected", None)
    assert body["reason_code"] == "OUTSIDE_GEOFENCE"
    assert [item.direction for item in punches(db_session) if item.decision == "accepted"] == ["in"]


def test_a_second_out_after_an_agreed_early_out_is_refused_as_closed(
    face_phone: TestClient,
) -> None:
    face_in_at_eight(face_phone)
    with frozen_at(ist(MONDAY, 10, 10)):
        asked = phone_face_punch(face_phone, person=1).json()
    with frozen_at(ist(MONDAY, 10, 11)):
        agree(face_phone, asked)

    with frozen_at(ist(MONDAY, 11, 0)):
        later = phone_face_punch(face_phone, person=1).json()

    assert (later["decision"], later["reason_code"]) == ("rejected", "SHIFT_ALREADY_CLOSED")


# --- Gate-code punch ---


def code_in_at_eight(gate: TestClient, g1: Device, phone: TestClient) -> None:
    with frozen_at(ist(MONDAY, 8, 0)) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        answer = send_code(phone, code)
    assert (answer.json()["decision"], answer.json()["direction"]) == ("accepted", "in")


def test_a_gate_code_out_before_the_end_asks_and_agree_saves_it_with_the_mark_and_the_selfie(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    code_in_at_eight(gate, g1, worker_phone)
    with frozen_at(ist(MONDAY, 15, 0)) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        asked = send_code(worker_phone, code).json()
        assert asked["decision"] == "needs_confirmation" and asked["punch_id"] is None
        assert asked["early_out"]["tier"] == "before_end"
        assert len(punches(db_session)) == 1  # nothing stored yet, no selfie either

        # The person reads the alert for 40 seconds: the code has expired by now, but it was fresh
        # when it was scanned, so Agree is still judged by that moment.
        clock.shift(timedelta(seconds=40))
        agreed = agree(worker_phone, asked, photo=True)
        again = agree(worker_phone, asked, photo=True)

    body = agreed.json()
    assert agreed.status_code == 200, agreed.text
    assert (body["decision"], body["direction"]) == ("accepted", "out")
    assert again.json() == body
    stored = punches(db_session)
    assert len(stored) == 2
    out = stored[1]
    assert (out.channel, out.method, out.early_out_mark) == (
        "phone",
        "gate_code",
        "EARLY_OUT_CONFIRMED",
    )
    snapshot = db_session.scalars(select(PunchSnapshot).where(PunchSnapshot.punch_id == out.id))
    assert snapshot.one().reason == "phone_gate_code"


def test_a_gate_code_cancel_saves_nothing(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    code_in_at_eight(gate, g1, worker_phone)
    with frozen_at(ist(MONDAY, 10, 0)) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        asked = send_code(worker_phone, code).json()

    assert asked["early_out"]["tier"] == "before_half"
    assert len(punches(db_session)) == 1
    assert db_session.scalars(select(PunchSnapshot)).all() != []  # only the IN's selfie
    assert len(db_session.scalars(select(PunchSnapshot)).all()) == 1


def test_a_gate_code_out_after_the_end_does_not_ask(
    gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    code_in_at_eight(gate, g1, worker_phone)
    with frozen_at(ist(MONDAY, 19, 10)) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        answer = send_code(worker_phone, code).json()

    assert (answer["decision"], answer["direction"], answer["early_out"]) == (
        "accepted",
        "out",
        None,
    )


def test_a_gate_code_agree_without_a_selfie_is_refused_and_no_out_is_saved(
    db_session: Session, gate: TestClient, g1: Device, worker_phone: TestClient
) -> None:
    code_in_at_eight(gate, g1, worker_phone)
    with frozen_at(ist(MONDAY, 10, 0)) as clock:
        code = ask_code(gate, g1).json()["code_text"]
        clock.shift(timedelta(seconds=5))
        asked = send_code(worker_phone, code).json()
        clock.shift(timedelta(seconds=5))
        agreed = agree(worker_phone, asked, photo=False)

    assert agreed.json()["decision"] == "rejected"
    assert agreed.json()["reason_code"] == "SNAPSHOT_MISSING"
    assert [item.direction for item in punches(db_session) if item.decision == "accepted"] == ["in"]
