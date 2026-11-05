"""M6 gap tests for M5 AC-39 (SHIFT_ALREADY_CLOSED): the face punch at the gate, the card and face
punches at offline sync (judged by their proven time), the Night shift edges and the rule order.
The online card case is in test_m5_shift_closed.py."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.antiproxy import engine
from app.antiproxy.rules.cooldown import check_in_out
from app.antiproxy.rules.impossible_travel import check_impossible_travel
from app.antiproxy.rules.shift_closed import check_shift_closed
from app.core.time import today_ist, utc_now
from app.modules.punches.models import Punch
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.offline_helpers import OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_face_punch_api import face_punch
from tests.test_punch_api import Worker, make_worker, photo_text, send

pytestmark = [pytest.mark.usefixtures("early_out_alert_off"), pytest.mark.time_sensitive]

THURSDAY = date(2026, 10, 29)
FRIDAY = THURSDAY + timedelta(days=1)


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
def plant(boss: TestClient, db_session: Session) -> PlantIds:
    with frozen_at(ist(THURSDAY, 6, 0)):
        return create_plant(boss, db_session, "K134")


@pytest.fixture
def device(db_session: Session, plant: PlantIds) -> Device:
    device = Device()
    make_active_kiosk(db_session, plant, device)
    return device


def test_a_face_punch_after_the_out_of_the_same_shift_is_refused_at_the_gate(
    boss: TestClient, db_client: TestClient, db_session: Session, plant: PlantIds, device: Device
) -> None:
    """M5 AC-39 (face, online): IN 09:00, OUT 17:00, then 20:00 is SHIFT_ALREADY_CLOSED; the next
    day's 09:00 is a new IN."""
    with frozen_at(ist(THURSDAY, 6, 0)):
        employee_id = new_employee(boss, plant, code="1043")
        assert enrol(boss, employee_id, person=1).status_code == 201

    answers = {}
    for label, day, hour in (
        ("in", THURSDAY, 9),
        ("out", THURSDAY, 17),
        ("late", THURSDAY, 20),
        ("next_day", FRIDAY, 9),
    ):
        with frozen_at(ist(day, hour, 0)):
            answers[label] = face_punch(db_client, device, person=1).json()

    assert (answers["in"]["decision"], answers["in"]["direction"]) == ("accepted", "in")
    assert (answers["out"]["decision"], answers["out"]["direction"]) == ("accepted", "out")
    assert answers["late"]["decision"] == "rejected"
    assert answers["late"]["reason_code"] == "SHIFT_ALREADY_CLOSED"
    assert (answers["next_day"]["decision"], answers["next_day"]["direction"]) == (
        "accepted",
        "in",
    )


def test_card_and_face_punches_after_the_out_are_refused_at_sync_by_their_proven_time(
    boss: TestClient, db_client: TestClient, db_session: Session, plant: PlantIds, device: Device
) -> None:
    """M5 AC-39 (offline): the item whose proven time is 20:00 is refused, for card and for face."""
    with frozen_at(ist(THURSDAY, 6, 0)):
        worker: Worker = make_worker(boss, db_session, plant)
        card = db_session.get(QrCredential, worker.card_id)
        assert card is not None
        card.valid_from = today_ist() - timedelta(days=2)
        db_session.commit()
        employee_id = new_employee(boss, plant, code="2001")
        assert enrol(boss, employee_id, person=2).status_code == 201

    with frozen_at(ist(THURSDAY, 21, 0)):
        gate = OfflineGate(device)
        gate.take_anchor(utc_now() - timedelta(hours=13))  # 08:00 IST
        face = {
            "employee_code": "2001",
            "frames": [frame(2), frame(2, yaw=25.0, role="turn"), frame(2)],
        }
        card_proof = card_evidence(worker.qr_text, photo_text())
        # IN 09:00, OUT 17:00, a third punch 20:00 (hours after the anchor: 1, 9 and 12).
        items = [
            gate.item(method, evidence, elapsed=timedelta(hours=hours), challenge=challenge)
            for hours in (1, 9, 12)
            for method, evidence, challenge in (
                ("qr", card_proof, None),
                ("face", face, "turn_left"),
            )
        ]
        answer = gate.send(db_client, items)

    assert answer.status_code == 200, answer.text
    results = answer.json()["results"]
    assert [(r["decision"], r.get("reason_code")) for r in results[:4]] == [("accepted", None)] * 4
    assert [(r["decision"], r["reason_code"]) for r in results[4:]] == [
        ("rejected", "SHIFT_ALREADY_CLOSED")
    ] * 2
    refused = db_session.scalars(select(Punch).where(Punch.decision == "rejected")).all()
    assert {punch.reason_codes[0] for punch in refused} == {"SHIFT_ALREADY_CLOSED"}


def test_the_night_shift_edges_of_the_closed_rule(
    boss: TestClient, db_client: TestClient, db_session: Session, plant: PlantIds, device: Device
) -> None:
    """M5 AC-39 (Night shift 19:00-07:00): OUT on 30/10 07:00 closes day 29/10; a punch at 14:59
    is refused, one at 19:00 (day 30/10) is accepted."""
    with frozen_at(ist(THURSDAY, 6, 0)):
        worker = make_worker(boss, db_session, plant)
        night = boss.post(
            f"/api/v1/plants/{plant.id}/shifts",
            json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
        ).json()
        moved = boss.patch(
            f"/api/v1/employees/{worker.employee_id}", json={"shift_id": night["id"]}
        )
        assert moved.status_code == 200, moved.text

    answers = []
    for day, hour, minute in (
        (THURSDAY, 19, 0),  # IN of day 29/10
        (FRIDAY, 7, 0),  # OUT of day 29/10
        (FRIDAY, 14, 59),  # still day 29/10: refused
        (FRIDAY, 19, 0),  # day 30/10: a new IN
    ):
        with frozen_at(ist(day, hour, minute)):
            answers.append(send(boss, device, worker.qr_text).json())

    assert [(a["decision"], a["direction"]) for a in answers[:2]] == [
        ("accepted", "in"),
        ("accepted", "out"),
    ]
    assert answers[2]["decision"] == "rejected"
    assert answers[2]["reason_code"] == "SHIFT_ALREADY_CLOSED"
    assert (answers[3]["decision"], answers[3]["direction"]) == ("accepted", "in")


def test_the_closed_rule_runs_after_in_out_and_before_impossible_travel() -> None:
    """M5 AC-39 (rule order): the same list serves the card, face and offline punches."""
    order = engine.AFTER_IDENTITY_RULES
    assert order.index(check_in_out) < order.index(check_shift_closed)
    assert order.index(check_shift_closed) < order.index(check_impossible_travel)
    assert order[: order.index(check_shift_closed) + 1][-2:] == (check_in_out, check_shift_closed)
    for rules in (engine.QR_RULES, engine.OFFLINE_QR_RULES):
        assert check_shift_closed in rules
