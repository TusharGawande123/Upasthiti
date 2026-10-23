"""Face punches in the admin punch log, the face-in-photo check on card photos and the re-enrol
hint (spec M3 §5.5, §7 rules 15 and 16; AC-23, AC-24, AC-37, AC-38)."""

import base64
import uuid
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.face.fake_engine import make_fake_frame
from app.modules.audit.models import AuditLog
from app.modules.face.engine_provider import get_face_engine
from app.modules.face.models import FaceTemplate
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_face_punch_api import code_try, face_punch
from tests.test_punch_api import Worker, send

PUNCHES = "/api/v1/punches"


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
def code_path(
    boss: TestClient, db_client: TestClient, k134: PlantIds, device: Device, kiosk: KioskDevice
) -> dict[str, str]:
    """Persons 1 (code 2001) and 2 at K134; person 14 asks for the code, types 2001: accepted."""
    first = new_employee(boss, k134, code="2001")
    enrol(boss, first, person=1)
    enrol(boss, new_employee(boss, k134, code="2002"), person=2)
    asked = face_punch(db_client, device, person=14).json()
    final = code_try(db_client, device, asked["code_entry"]["token"], "2001").json()
    return {"employee": first, "asked": asked["punch_id"], "final": final["punch_id"]}


# --- Punch log (AC-24) -------------------------------------------------------------------------


def test_the_log_shows_face_rows_and_filters_them(
    boss: TestClient, code_path: dict[str, str]
) -> None:
    items = boss.get(PUNCHES).json()["items"]
    by_id = {item["id"]: item for item in items}
    assert by_id[code_path["asked"]]["decision"] == "needs_code"
    assert by_id[code_path["final"]]["match_mode"] == "code"
    assert by_id[code_path["final"]]["follows_punch_id"] == code_path["asked"]

    asked = boss.get(PUNCHES, params={"asked_for_code": "true"}).json()["items"]
    assert [item["id"] for item in asked] == [code_path["asked"]]
    by_code = boss.get(PUNCHES, params={"match_mode": "code"}).json()["items"]
    assert [item["id"] for item in by_code] == [code_path["final"]]
    assert len(boss.get(PUNCHES, params={"method": "face"}).json()["items"]) == 2
    assert boss.get(PUNCHES, params={"method": "qr"}).json()["items"] == []


def test_the_summary_counts_face_punches_and_asked_for_code_is_not_a_rejection(
    boss: TestClient, code_path: dict[str, str]
) -> None:
    summary = boss.get(f"{PUNCHES}/summary").json()

    assert summary["code_accepted"] == 1 and summary["asked_for_code"] == 1
    assert summary["face_accepted"] == 0 and summary["rejected"] == 0
    assert summary["accepted_in"] == 1


def test_only_the_super_admin_sees_scores_and_the_typed_code(
    db_app: FastAPI, db_session: Session, boss: TestClient, code_path: dict[str, str]
) -> None:
    detail = boss.get(f"{PUNCHES}/{code_path['final']}").json()
    face = detail["face"]
    assert face["match_mode"] == "code" and face["match_score"] > 0.5
    assert face["claimed_employee"]["code"] == "2001"
    asked = boss.get(f"{PUNCHES}/{code_path['asked']}").json()["face"]
    assert asked["challenge"] in ("turn_left", "turn_right") and asked["antispoof_score"] > 0.9

    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    hidden = corporate.get(f"{PUNCHES}/{code_path['final']}").json()
    assert hidden["face"] is None and hidden["method"] == "face"


def test_the_code_path_answer_shows_the_photo_of_its_question(
    boss: TestClient, db_session: Session, code_path: dict[str, str]
) -> None:
    response = boss.get(f"{PUNCHES}/{code_path['final']}/snapshot")

    assert response.status_code == 200 and response.content[:3] == b"\xff\xd8\xff"
    viewed = db_session.scalars(select(AuditLog).where(AuditLog.action == "snapshot.view")).one()
    assert viewed.entity_id == uuid.UUID(code_path["asked"])


# --- F-30: a face on the card photo (AC-37) ----------------------------------------------------


def card_photo(person: int) -> str:
    return base64.b64encode(make_fake_frame(person, width=320, height=240)).decode()


def test_a_card_photo_without_a_face_is_marked_but_the_punch_is_decided_as_before(
    db_app: FastAPI,
    db_session: Session,
    boss: TestClient,
    db_client: TestClient,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    worker = Worker(boss, k134)

    answer = send(db_client, device, worker.qr_text, snapshot=card_photo(0)).json()

    assert answer["decision"] == "accepted"
    snapshot = db_session.scalars(select(PunchSnapshot)).one()
    assert snapshot.face_found is False
    assert boss.get(f"{PUNCHES}/summary").json()["no_face_photos"] == 1
    marked = boss.get(PUNCHES, params={"no_face_photo": "true"}).json()["items"]
    assert len(marked) == 1 and marked[0]["snapshot"]["face_found"] is False

    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    assert corporate.get(f"{PUNCHES}/summary").json()["no_face_photos"] is None
    assert corporate.get(PUNCHES).json()["items"][0]["snapshot"]["face_found"] is None


def test_a_card_photo_with_a_face_is_marked_found(
    db_session: Session,
    boss: TestClient,
    db_client: TestClient,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    send(db_client, device, Worker(boss, k134).qr_text, snapshot=card_photo(5))

    assert db_session.scalars(select(PunchSnapshot)).one().face_found is True


def test_with_the_face_engine_off_the_photo_stays_unchecked(
    db_app: FastAPI,
    db_session: Session,
    boss: TestClient,
    db_client: TestClient,
    k134: PlantIds,
    device: Device,
    kiosk: KioskDevice,
) -> None:
    db_app.dependency_overrides[get_face_engine] = lambda: FaceEngine(None)

    answer = send(db_client, device, Worker(boss, k134).qr_text, snapshot=card_photo(0)).json()

    assert answer["decision"] == "accepted"
    assert db_session.scalars(select(PunchSnapshot)).one().face_found is None


# --- F-41: re-enrol hint (AC-38) ---------------------------------------------------------------


def add_accepted(
    session: Session,
    kiosk: KioskDevice,
    employee_id: str,
    *,
    mode: str,
    score: float,
    claimed: bool = False,
    seconds_later: int = 0,
) -> None:
    session.add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=uuid.UUID(employee_id),
            claimed_employee_id=uuid.UUID(employee_id) if claimed else None,
            method="face",
            direction="in",
            decision="accepted",
            reason_codes=[],
            # After the template was made: only those punches count for the hint.
            server_received_at=utc_now() + timedelta(seconds=seconds_later),
            match_mode=mode,
            match_score=Decimal(str(score)),
            face_model_id="fake/fake",
        )
    )
    session.commit()


def test_three_code_entries_suggest_re_enrolling(
    boss: TestClient, db_session: Session, k134: PlantIds, kiosk: KioskDevice
) -> None:
    employee_id = new_employee(boss, k134, code="3001")
    enrol(boss, employee_id, person=3)
    for minutes in (1, 2, 3):
        add_accepted(
            db_session,
            kiosk,
            employee_id,
            mode="code",
            score=0.6,
            claimed=True,
            seconds_later=minutes,
        )

    panel = boss.get(f"/api/v1/employees/{employee_id}/face").json()

    assert panel["reenrol_suggested"] is True and panel["reenrol_reason"] == "code_entries"
    listed = boss.get("/api/v1/employees").json()["items"][0]
    assert listed["face_state"] == "reenrol_suggested"
    filtered = boss.get("/api/v1/employees", params={"face_state": "reenrol_suggested"}).json()
    assert [item["id"] for item in filtered["items"]] == [employee_id]
    assert boss.get("/api/v1/face/enrolment-progress").json()["totals"]["reenrol_suggested"] == 1

    enrol(boss, employee_id, person=3)  # a new template starts the count again
    newest = db_session.scalars(select(FaceTemplate).where(FaceTemplate.deleted_at.is_(None))).one()
    newest.enrolled_at = utc_now() + timedelta(minutes=1)  # the earlier punches are older
    db_session.commit()
    assert boss.get(f"/api/v1/employees/{employee_id}/face").json()["reenrol_suggested"] is False


def test_falling_match_scores_suggest_re_enrolling(
    boss: TestClient, db_session: Session, k134: PlantIds, kiosk: KioskDevice
) -> None:
    employee_id = new_employee(boss, k134, code="3002")
    enrol(boss, employee_id, person=4)
    for minutes in range(1, 6):  # median 0.47 < threshold 0.45 + margin 0.05
        add_accepted(
            db_session, kiosk, employee_id, mode="one_to_many", score=0.47, seconds_later=minutes
        )

    panel = boss.get(f"/api/v1/employees/{employee_id}/face").json()

    assert panel["reenrol_reason"] == "falling_scores"


def test_good_scores_give_no_hint(
    boss: TestClient, db_session: Session, k134: PlantIds, kiosk: KioskDevice
) -> None:
    employee_id = new_employee(boss, k134, code="3003")
    enrol(boss, employee_id, person=5)
    for minutes in range(1, 8):
        add_accepted(
            db_session, kiosk, employee_id, mode="one_to_many", score=0.9, seconds_later=minutes
        )

    assert boss.get(f"/api/v1/employees/{employee_id}/face").json()["reenrol_suggested"] is False
