"""The gate rule "shift already closed" and the unchanged "too soon to OUT" (M5 spec §7 rule 24,
§10 AC-39 to AC-41; examples E12, E14, E14b). Card punches through the real endpoint, the clock
frozen, the attendance device paired at a plant whose default shift is 07:00-19:00."""

from collections.abc import Iterator
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.factories import log_in
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, make_worker, send

THURSDAY = date(2026, 10, 29)
FRIDAY = THURSDAY + timedelta(days=1)


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from tests.conftest import clear_cached_settings

    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    yield


@pytest.fixture
def gate(db_app: FastAPI, db_session: Session) -> tuple[TestClient, Device, PlantIds, Worker]:
    with frozen_at(ist(THURSDAY, 6, 0)):
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant = create_plant(boss, db_session, "DEMO1")
        device = Device()
        make_active_kiosk(db_session, plant, device)
        worker = make_worker(boss, db_session, plant)
    return boss, device, plant, worker


def punch_at(gate: tuple, day: date, hour: int, minute: int = 0) -> dict:
    boss, device, _plant, worker = gate
    with frozen_at(ist(day, hour, minute)):
        response = send(boss, device, worker.qr_text)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_punch_after_the_out_of_the_same_shift_is_refused(gate: tuple) -> None:
    """E12/E14: IN 09:00, OUT 12:00 (a real OUT, 3 h after the IN), then 13:00 and 20:00 are
    refused with SHIFT_ALREADY_CLOSED."""
    first = punch_at(gate, THURSDAY, 9)
    second = punch_at(gate, THURSDAY, 12)
    third = punch_at(gate, THURSDAY, 13)
    fourth = punch_at(gate, THURSDAY, 18)

    assert (first["decision"], first["direction"]) == ("accepted", "in")
    assert (second["decision"], second["direction"]) == ("accepted", "out")
    assert third["decision"] == "rejected" and third["reason_code"] == "SHIFT_ALREADY_CLOSED"
    assert fourth["reason_code"] == "SHIFT_ALREADY_CLOSED"


def test_the_next_day_starts_a_new_shift(gate: tuple) -> None:
    """E14: the IN of the next shift day (its window starts at 03:00) is accepted."""
    punch_at(gate, THURSDAY, 9)
    punch_at(gate, THURSDAY, 17)

    next_morning = punch_at(gate, FRIDAY, 9)

    assert (next_morning["decision"], next_morning["direction"]) == ("accepted", "in")


def test_a_double_scan_is_still_a_cool_down_and_too_soon_is_still_too_soon(gate: tuple) -> None:
    """E14b: IN 09:00, a punch at 09:29 is OUT_TOO_SOON (30 minutes); at 09:30 it is the OUT.
    A scan right after the OUT is COOLDOWN_ACTIVE, not SHIFT_ALREADY_CLOSED."""
    punch_at(gate, THURSDAY, 9)

    too_soon = punch_at(gate, THURSDAY, 9, 29)
    out = punch_at(gate, THURSDAY, 9, 30)
    again = punch_at(gate, THURSDAY, 9, 31)

    assert too_soon["reason_code"] == "OUT_TOO_SOON"
    assert (out["decision"], out["direction"]) == ("accepted", "out")
    assert again["reason_code"] == "COOLDOWN_ACTIVE"


def test_a_carried_over_out_does_not_block_the_next_in(gate: tuple) -> None:
    """The OUT at 03:30 next morning closed yesterday's IN (rule 6.4): today's IN at 09:00 is fine
    because the window of today starts at 03:00 and the closing IN was yesterday's."""
    punch_at(gate, THURSDAY, 18)
    carried_out = punch_at(
        gate, FRIDAY, 2, 30
    )  # 8 h 30 m after the IN: still inside yesterday's day
    today_in = punch_at(gate, FRIDAY, 9)

    assert carried_out["direction"] == "out"
    assert (today_in["decision"], today_in["direction"]) == ("accepted", "in")


def test_a_rejected_closed_shift_punch_can_be_approved_for_the_day(
    gate: tuple, db_session: Session
) -> None:
    """The refusal names the employee, so the Super Admin can approve it (M4 rule 7): the stored
    punch row is a rejection with the code, the OUT that closed the day is its related punch."""
    punch_at(gate, THURSDAY, 9)
    punch_at(gate, THURSDAY, 12)
    refused = punch_at(gate, THURSDAY, 17)

    rows = list(db_session.scalars(select(Punch).order_by(Punch.server_received_at)))

    assert refused["reason_code"] == "SHIFT_ALREADY_CLOSED"
    assert rows[-1].decision == "rejected" and rows[-1].employee_id is not None
    assert rows[-1].related_punch_id == rows[1].id  # the OUT that closed the day


def test_the_review_suggests_out_and_shows_the_out_that_closed_the_day(
    gate: tuple, db_session: Session
) -> None:
    """Spec §7 rule 24, review: the approve dialog suggests OUT and lists the closing OUT."""
    boss = gate[0]
    punch_at(gate, THURSDAY, 9)
    punch_at(gate, THURSDAY, 12)
    punch_at(gate, THURSDAY, 17)
    refused = db_session.scalars(select(Punch).order_by(Punch.server_received_at.desc())).first()
    assert refused is not None

    with frozen_at(ist(THURSDAY, 18, 0)):
        log_in(boss, "boss")  # the 06:00 login has been idle for 12 hours
        context = boss.get(f"/api/v1/punches/{refused.id}/review-context")

    assert context.status_code == 200, context.text
    body = context.json()
    assert body["approvable"] is True
    assert body["suggestion"]["direction"] == "out"
    assert [item["relation"] for item in body["related"]] == ["closing_out"]
