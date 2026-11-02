"""Attendance corrections (M5 spec §5.2, §7 rules 12–13, §9; AC-16 to AC-22).
Real PostgreSQL, fake data, the clock pinned to Fri 30/10/2026 12:00 IST."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.service import ensure_fresh
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

FRIDAY = date(2026, 10, 30)
THURSDAY = date(2026, 10, 29)
NOW = ist(FRIDAY, 12, 0)
URL = "/api/v1/regularisations"


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant = create_plant(boss, db_session, "DEMO1")
    other = create_plant(boss, db_session, "DEMO2")
    for item in (plant, other):
        boss.patch(f"/api/v1/plants/{item.id}", json={"attendance_start_date": "2026-10-01"})
    shift = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
    ).json()
    employee = boss.post(
        "/api/v1/employees", json=permanent_body(plant, code="E-1") | {"shift_id": shift["id"]}
    ).json()
    other_employee = boss.post("/api/v1/employees", json=permanent_body(other, code="E-2")).json()
    kiosk = make_active_kiosk(db_session, plant, Device())
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    other_head = client_for(db_app, db_session, Role.PLANT_HEAD, "other_head")
    for username, item in (("head", plant), ("other_head", other)):
        user = db_session.scalars(select(User).where(User.username == username)).one()
        set_user_plant(db_session, user, uuid.UUID(item.id))
    db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "other_head": other_head,
        "corporate": client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp"),
        "plant": plant,
        "kiosk": kiosk,
        "employee": uuid.UUID(employee["id"]),
        "other_employee": uuid.UUID(other_employee["id"]),
        "session": db_session,
    }


def punch(world: dict, moment: datetime, direction: str, accepted: bool = True) -> Punch:
    kiosk: KioskDevice = world["kiosk"]
    row = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=world["employee"],
        method="face",
        direction=direction if accepted else None,
        decision="accepted" if accepted else "rejected",
        reason_codes=[] if accepted else ["FACE_NO_MATCH"],
        server_received_at=moment,
        was_offline=False,
    )
    world["session"].add(row)
    world["session"].commit()
    return row


def body(world: dict, **extra: object) -> dict:
    base = {
        "employee_id": str(world["employee"]),
        "attendance_date": THURSDAY.isoformat(),
        "kind": "add_punch",
        "direction": "out",
        "out_time": ist(THURSDAY, 17, 5).isoformat(),
        "reason": "Gate device was slow",
    }
    return base | extra


def day_status(world: dict, day: date) -> str:
    session: Session = world["session"]
    ensure_fresh(session, [world["employee"]], day, day, NOW)
    row = session.scalars(
        select(AttendanceDay).where(
            AttendanceDay.employee_id == world["employee"], AttendanceDay.attendance_date == day
        )
    ).one()
    session.refresh(row)
    return row.status


def test_request_then_approve_completes_the_day_and_leaves_the_punches_alone(world: dict) -> None:
    """AC-16 (E13): IN 09:02, no OUT; the Plant Head asks for OUT 17:05; the Super Admin agrees."""
    punch(world, ist(THURSDAY, 9, 2), "in")
    punches_before = world["session"].scalar(select(func.count()).select_from(Punch))
    assert day_status(world, THURSDAY) == "incomplete"

    asked = world["head"].post(URL, json=body(world))
    assert asked.status_code == 201, asked.text
    correction = asked.json()["correction"]
    assert correction["state"] == "pending" and correction["is_direct"] is False
    assert day_status(world, THURSDAY) == "incomplete"  # nothing changes before approval
    approved = world["boss"].post(f"{URL}/{correction['id']}/approve", json={"note": "Checked"})

    assert approved.status_code == 200, approved.text
    assert approved.json()["correction"]["state"] == "approved"
    assert day_status(world, THURSDAY) == "present"
    assert world["session"].scalar(select(func.count()).select_from(Punch)) == punches_before
    actions = set(
        world["session"].scalars(
            select(AuditLog.action).where(AuditLog.entity_type == "attendance_correction")
        )
    )
    assert actions == {"attendance_correction.request", "attendance_correction.approve"}


def test_reject_keeps_the_day_and_records_the_reason(world: dict) -> None:
    """AC-17."""
    punch(world, ist(THURSDAY, 9, 2), "in")
    correction = world["head"].post(URL, json=body(world)).json()["correction"]

    rejected = world["boss"].post(f"{URL}/{correction['id']}/reject", json={"reason": "No proof"})
    again = world["boss"].post(f"{URL}/{correction['id']}/approve", json={})

    assert rejected.json()["correction"]["decision"]["reason"] == "No proof"
    assert again.json()["error"]["code"] == "CORRECTION_NOT_PENDING"
    assert day_status(world, THURSDAY) == "incomplete"


def test_the_requester_can_withdraw_but_nobody_else(world: dict) -> None:
    punch(world, ist(THURSDAY, 9, 2), "in")
    correction = world["head"].post(URL, json=body(world)).json()["correction"]

    stranger = world["corporate"].post(f"{URL}/{correction['id']}/withdraw")
    own = world["head"].post(f"{URL}/{correction['id']}/withdraw")

    assert stranger.json()["error"]["code"] == "FORBIDDEN"
    assert own.json()["correction"]["state"] == "withdrawn"


def test_roles(world: dict) -> None:
    """AC-18: a Corporate Head asks for any plant but cannot decide, reverse or enter leave; a
    Plant Head gets NOT_FOUND for another plant's employee."""
    punch(world, ist(THURSDAY, 9, 2), "in")
    asked = world["corporate"].post(URL, json=body(world))
    correction = asked.json()["correction"]

    assert asked.status_code == 201
    for path in ("approve", "reject", "reverse"):
        response = world["corporate"].post(
            f"{URL}/{correction['id']}/{path}", json={"reason": "Not allowed", "note": "x"}
        )
        assert response.json()["error"]["code"] == "FORBIDDEN"
    foreign = world["head"].post(URL, json=body(world, employee_id=str(world["other_employee"])))
    assert foreign.json()["error"]["code"] == "NOT_FOUND"


def test_a_plant_head_cannot_correct_a_day_the_person_spent_at_another_plant(
    world: dict,
) -> None:
    """AC-18: the transferred employee's old days stay with the old plant."""
    boss, session = world["boss"], world["session"]
    other: PlantIds = create_plant(boss, session, "DEMO3")
    boss.patch(f"/api/v1/plants/{other.id}", json={"attendance_start_date": "2026-10-01"})
    moved = boss.post(
        f"/api/v1/employees/{world['employee']}/transfer",
        json={
            "to_plant_id": other.id,
            "category_id": other.staff_id,
            "shift_id": other.shift_id,
            "effective_from": FRIDAY.isoformat(),
            "reason": "New plant",
        },
    )
    assert moved.status_code == 200, moved.text
    new_head = client_for(world["head"].app, session, Role.PLANT_HEAD, "new_head")
    user = session.scalars(select(User).where(User.username == "new_head")).one()
    set_user_plant(session, user, uuid.UUID(other.id))
    session.commit()

    old_day = new_head.post(URL, json=body(world))

    assert old_day.json()["error"]["code"] == "NOT_FOUND" or old_day.status_code == 403


def test_direct_correction_by_the_super_admin_and_its_reversal(world: dict) -> None:
    """AC-19: add_in_out 09:00–17:00 is approved at once; reversing it restores the day and both
    rows stay."""
    assert day_status(world, THURSDAY) == "absent"
    direct = world["boss"].post(
        URL,
        json={
            "employee_id": str(world["employee"]),
            "attendance_date": THURSDAY.isoformat(),
            "kind": "add_in_out",
            "in_time": ist(THURSDAY, 9, 0).isoformat(),
            "out_time": ist(THURSDAY, 17, 0).isoformat(),
            "reason": "The gate device was broken",
        },
    )
    correction = direct.json()["correction"]
    assert correction["is_direct"] is True and correction["state"] == "approved"
    assert day_status(world, THURSDAY) == "present"

    reversed_ = world["boss"].post(
        f"{URL}/{correction['id']}/reverse", json={"reason": "Wrong day"}
    )
    twice = world["boss"].post(f"{URL}/{correction['id']}/reverse", json={"reason": "Again"})

    assert reversed_.status_code == 201
    assert twice.json()["error"]["code"] == "CORRECTION_ALREADY_REVERSED"
    assert day_status(world, THURSDAY) == "absent"
    listed = world["boss"].get(URL, params={"employee_id": str(world["employee"])}).json()
    assert listed["total"] == 2
    states = {item["id"]: item["state"] for item in listed["items"]}
    assert states[correction["id"]] == "reversed"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"out_time": ist(FRIDAY, 13, 0).isoformat()}, "CORRECTION_TIME_IN_FUTURE"),
        ({"out_time": ist(date(2026, 10, 27), 17, 0).isoformat()}, "CORRECTION_TIME_OUTSIDE_DAY"),
        ({"attendance_date": "2026-10-31"}, "ATTENDANCE_DATE_INVALID"),
        ({"attendance_date": "2026-08-01"}, "CORRECTION_TOO_OLD"),
        ({"attendance_date": "2026-09-30"}, "ATTENDANCE_DAY_NOT_ACTIVE"),  # before the start date
    ],
)
def test_validation_codes_for_a_request(world: dict, change: dict, code: str) -> None:
    """AC-21 (one test per case)."""
    response = world["head"].post(URL, json=body(world, **change))

    assert response.json()["error"]["code"] == code


def test_a_time_next_to_a_punch_is_near_a_punch(world: dict) -> None:
    punch(world, ist(THURSDAY, 9, 2), "in")
    response = world["head"].post(
        URL,
        json=body(
            world,
            direction="in",
            in_time=ist(THURSDAY, 9, 3).isoformat(),
            out_time=None,
        ),
    )

    assert response.json()["error"]["code"] == "CORRECTION_NEAR_PUNCH"


def test_duplicates_ignore_and_status_checks(world: dict) -> None:
    first_in = punch(world, ist(THURSDAY, 9, 2), "in")
    world["head"].post(URL, json=body(world))
    duplicate = world["head"].post(URL, json=body(world))
    not_counted = world["head"].post(
        URL,
        json={
            "employee_id": str(world["employee"]),
            "attendance_date": THURSDAY.isoformat(),
            "kind": "ignore_punch",
            "punch_id": str(uuid.uuid4()),
            "reason": "Wrong punch",
        },
    )
    counted = world["head"].post(
        URL,
        json={
            "employee_id": str(world["employee"]),
            "attendance_date": THURSDAY.isoformat(),
            "kind": "ignore_punch",
            "punch_id": str(first_in.id),
            "reason": "Wrong punch",
        },
    )
    today_status = world["boss"].post(
        URL,
        json={
            "employee_id": str(world["employee"]),
            "attendance_date": FRIDAY.isoformat(),
            "kind": "set_status",
            "status_value": "present",
            "reason": "Official duty",
        },
    )

    assert duplicate.json()["error"]["code"] == "CORRECTION_DUPLICATE"
    assert not_counted.json()["error"]["code"] == "CORRECTION_PUNCH_NOT_COUNTED"
    assert counted.status_code == 201
    assert today_status.json()["error"]["code"] == "ATTENDANCE_DAY_NOT_ACTIVE"  # still open


def test_set_status_decides_a_short_hours_day_but_not_for_temporary_workers(
    world: dict,
) -> None:
    """AC-6c: E7 is Short hours; the Super Admin decides it as half-day."""
    punch(world, ist(THURSDAY, 9, 0), "in")
    punch(world, ist(THURSDAY, 12, 50), "out")
    assert day_status(world, THURSDAY) == "short_hours"

    decided = world["boss"].post(
        URL,
        json={
            "employee_id": str(world["employee"]),
            "attendance_date": THURSDAY.isoformat(),
            "kind": "set_status",
            "status_value": "half_day",
            "reason": "Doctor visit",
        },
    )

    assert decided.status_code == 201, decided.text
    assert day_status(world, THURSDAY) == "half_day"
    temporary = (
        world["boss"]
        .post(
            "/api/v1/employees",
            json=permanent_body(world["plant"], code="T-9")
            | {
                "type": "temporary",
                "hourly_rate": "85.00",
                "category_id": world["plant"].helper_id,
            },
        )
        .json()
    )
    refused = world["boss"].post(
        URL,
        json={
            "employee_id": temporary["id"],
            "attendance_date": THURSDAY.isoformat(),
            "kind": "set_status",
            "status_value": "present",
            "reason": "Not allowed",
        },
    )
    assert refused.json()["error"]["code"] == "CORRECTION_KIND_NOT_FOR_TEMPORARY"


def test_preview_shows_the_day_before_and_after_and_stores_nothing(world: dict) -> None:
    punch(world, ist(THURSDAY, 9, 2), "in")

    shown = world["head"].post(f"{URL}/preview", json=body(world))

    assert shown.status_code == 200, shown.text
    assert shown.json()["before"]["status"] == "incomplete"
    assert shown.json()["after"]["status"] == "present"
    assert shown.json()["after"]["worked_min"] == 483
    assert world["boss"].get(URL).json()["total"] == 0


def test_approval_checks_again_and_the_summary_counts_pending(world: dict) -> None:
    punch(world, ist(THURSDAY, 9, 2), "in")
    correction = world["head"].post(URL, json=body(world)).json()["correction"]
    assert world["boss"].get(f"{URL}/summary").json() == {"pending": 1, "mine_pending": 0}
    assert world["head"].get(f"{URL}/summary").json() == {"pending": 1, "mine_pending": 1}
    # A punch arrives meanwhile that sits next to the requested time.
    punch(world, ist(THURSDAY, 17, 4), "out")

    approve = world["boss"].post(f"{URL}/{correction['id']}/approve", json={})

    assert approve.status_code == 409
    assert approve.json()["error"]["code"] == "CORRECTION_NO_LONGER_VALID"
    assert approve.json()["error"]["details"]["reason_code"] == "CORRECTION_NEAR_PUNCH"


def test_corrections_cannot_be_changed_or_deleted(world: dict) -> None:
    """AC-20."""
    punch(world, ist(THURSDAY, 9, 2), "in")
    correction = world["head"].post(URL, json=body(world)).json()["correction"]
    world["boss"].post(f"{URL}/{correction['id']}/approve", json={})
    session: Session = world["session"]

    for statement in (
        "UPDATE regularisations SET reason = 'changed' WHERE id = :id",
        "DELETE FROM regularisations WHERE id = :id",
        "UPDATE regularisation_decisions SET note = 'x' WHERE regularisation_id = :id",
        "DELETE FROM regularisation_decisions WHERE regularisation_id = :id",
    ):
        with pytest.raises(DBAPIError, match="append-only"), session.begin_nested():
            session.execute(text(statement), {"id": correction["id"]})
