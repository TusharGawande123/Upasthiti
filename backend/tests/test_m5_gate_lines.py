"""The small gate lines of M5 (spec §4.16, §7 rule 29; F-28, F-37, F-2; AC-50 to AC-52): "Inside
now" on the idle screen, the gentle late hint and the "My month" line after a punch. Numbers made
by the server, never a name, only for online accepted punches, and off unless switched on."""

from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.modules.users.models import Role
from tests.clock_helpers import frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, new_employee, set_privacy
from tests.factories import log_in
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_face_punch_api import face_punch
from tests.test_punch_api import make_worker, send

THURSDAY = date(2026, 10, 29)
FRIDAY = date(2026, 10, 30)


def at(day: date, hour: int, minute: int = 0):
    return frozen_at(ist(day, hour, minute))


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict[str, Any]:
    """One face employee (code 2001) and one card worker at a DEMO plant."""
    with at(THURSDAY, 6):
        set_privacy(db_session)
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant: PlantIds = create_plant(boss, db_session, "DEMO1")
        device = Device()
        kiosk = make_active_kiosk(db_session, plant, device)
        face_employee = new_employee(boss, plant, code="2001")
        enrol(boss, face_employee, person=1)
        worker = make_worker(boss, db_session, plant)
    return {
        "boss": boss,
        "device": device,
        "kiosk": kiosk,
        "worker": worker,
        "session": db_session,
        "app": db_app,
    }


def switch_on(world: dict, **values: str) -> None:
    with at(THURSDAY, 7):
        log_in(world["boss"], "boss")
        response = world["boss"].put(
            "/api/v1/settings", json={"values": values, "reason": "Gate lines"}
        )
        assert response.status_code == 200, response.text


def me(world: dict, when) -> dict:  # noqa: ANN001
    with when:
        response = signed_get(world, "/api/v1/kiosk/me")
    assert response.status_code == 200, response.text
    return response.json()


def signed_get(world: dict, path: str):
    device: Device = world["device"]
    headers = device.headers("GET", path, b"")
    return world["boss"].get(path, headers=headers)


def test_inside_now_and_the_screen_switches_follow_the_settings(world: dict) -> None:
    with at(THURSDAY, 9):
        send(world["boss"], world["device"], world["worker"].qr_text)
        face_punch(world["boss"], world["device"], person=1)

    default = me(world, at(THURSDAY, 9, 5))
    switch_on(world, kiosk_late_hint="on", kiosk_show_month_line="on")
    switched = me(world, at(THURSDAY, 9, 6))

    assert default["inside_now"] == 2  # F-28 is on by default: a number, no names
    assert default["kiosk_settings"]["screen"] == {
        "show_inside_count": True,
        "late_hint": False,
        "show_month_line": False,
    }
    assert switched["kiosk_settings"]["screen"]["late_hint"] is True
    switch_on(world, kiosk_show_inside_count="off")
    assert me(world, at(THURSDAY, 9, 7))["inside_now"] is None


def test_the_late_hint_and_the_month_line_come_with_an_accepted_face_in(world: dict) -> None:
    """Default shift 07:00-19:00, grace 30: an IN at 09:00 is 120 minutes late."""
    with at(THURSDAY, 9):
        before = face_punch(world["boss"], world["device"], person=1).json()
    switch_on(world, kiosk_late_hint="on", kiosk_show_month_line="on")
    with at(FRIDAY, 9):
        after = face_punch(world["boss"], world["device"], person=1).json()

    assert before["gate_lines"] is None  # both are off until switched on
    assert (after["decision"], after["direction"]) == ("accepted", "in")
    assert after["gate_lines"] == {"late_minutes": 120, "month_days_present": 2}
    assert "Person" not in str(after["gate_lines"])


def test_no_late_hint_inside_the_grace_for_the_card_worker_or_after_the_first_in(
    world: dict,
) -> None:
    switch_on(world, kiosk_late_hint="on", kiosk_show_month_line="on")
    with at(THURSDAY, 7, 20):  # inside the grace (until 07:30)
        in_time = face_punch(world["boss"], world["device"], person=1).json()
    with at(THURSDAY, 12, 0):
        out = face_punch(world["boss"], world["device"], person=1).json()
    with at(THURSDAY, 9, 0):  # a temporary (card) worker: no late hint, but the month line
        worker = send(world["boss"], world["device"], world["worker"].qr_text).json()

    assert in_time["gate_lines"] == {"late_minutes": None, "month_days_present": 1}
    assert out["decision"] in ("accepted", "needs_confirmation")
    assert worker["gate_lines"] == {"late_minutes": None, "month_days_present": 1}


def test_nothing_is_added_to_a_rejected_punch_or_the_early_out_alert(world: dict) -> None:
    switch_on(world, kiosk_late_hint="on", kiosk_show_month_line="on")
    with at(THURSDAY, 9):
        face_punch(world["boss"], world["device"], person=1)
    with at(THURSDAY, 10, 10):  # an OUT before the shift end: the alert, nothing is stored
        asked = face_punch(world["boss"], world["device"], person=1).json()
    with at(THURSDAY, 10, 11):
        refused = send(world["boss"], world["device"], "not a card").json()

    assert asked["decision"] == "needs_confirmation" and asked["gate_lines"] is None
    assert refused["decision"] == "rejected" and refused["gate_lines"] is None
