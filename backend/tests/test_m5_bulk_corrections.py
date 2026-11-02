"""Bulk correction after a gate outage (M5 spec §5.2, §7 rule 27; F-59; AC-45). Real PostgreSQL,
fake data, the clock pinned to Fri 30/10/2026 12:00 IST."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.service import ensure_fresh
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch
from app.modules.regularisations.models import Regularisation
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import client_for, create_plant, permanent_body

THURSDAY = date(2026, 10, 29)
FRIDAY = date(2026, 10, 30)
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
    people = {}
    for code in ("P-1", "P-2", "P-3"):
        body = permanent_body(plant, code=code) | {"shift_id": shift["id"]}
        people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
    foreigner = boss.post("/api/v1/employees", json=permanent_body(other, code="O-1")).json()
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
        "people": people,
        "foreigner": uuid.UUID(foreigner["id"]),
        "kiosk": kiosk,
        "session": db_session,
    }


def punch(world: dict, code: str, moment: datetime, direction: str) -> None:
    kiosk: KioskDevice = world["kiosk"]
    world["session"].add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=world["people"][code],
            method="face",
            direction=direction,
            decision="accepted",
            reason_codes=[],
            server_received_at=moment,
            was_offline=False,
        )
    )
    world["session"].commit()


def bulk_body(world: dict, codes: tuple[str, ...] = ("P-1", "P-2", "P-3"), **extra: object) -> dict:
    return {
        "plant_id": world["plant"].id,
        "attendance_date": THURSDAY.isoformat(),
        "kind": "add_in_out",
        "in_time": ist(THURSDAY, 9, 0).isoformat(),
        "out_time": ist(THURSDAY, 17, 0).isoformat(),
        "employee_ids": [str(world["people"][code]) for code in codes],
        "reason": "The attendance device was off all day (power cut)",
    } | extra


def status_of(world: dict, code: str) -> str:
    session: Session = world["session"]
    later = ist(date(2026, 11, 3), 12, 0)
    with frozen_at(later):
        ensure_fresh(session, [world["people"][code]], THURSDAY, THURSDAY, later)
    row = session.scalars(
        select(AttendanceDay).where(
            AttendanceDay.employee_id == world["people"][code],
            AttendanceDay.attendance_date == THURSDAY,
        )
    ).one()
    session.refresh(row)
    return row.status


def test_the_preview_shows_who_changes_and_who_is_skipped_and_stores_nothing(world: dict) -> None:
    punch(world, "P-3", ist(THURSDAY, 9, 1), "in")  # P-3 did punch: the added IN is too near

    shown = world["boss"].post(f"{URL}/bulk/preview", json=bulk_body(world))

    assert shown.status_code == 200, shown.text
    body = shown.json()
    assert (body["will_create"], body["will_skip"]) == (2, 1)
    by_code = {item["employee"]["code"]: item for item in body["items"]}
    assert by_code["P-1"]["before"]["status"] == "absent"
    assert by_code["P-1"]["after"]["status"] == "present"
    assert (
        by_code["P-3"]["skip_code"] == "CORRECTION_NEAR_PUNCH" and by_code["P-3"]["after"] is None
    )
    assert world["session"].scalar(select(func.count()).select_from(Regularisation)) == 0


def test_the_super_admin_corrects_many_at_once_and_the_skipped_are_listed(world: dict) -> None:
    punch(world, "P-3", ist(THURSDAY, 9, 1), "in")

    created = world["boss"].post(URL + "/bulk", json=bulk_body(world))

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["created"] == 2
    assert body["skipped"] == [
        {"employee_id": str(world["people"]["P-3"]), "code": "CORRECTION_NEAR_PUNCH"}
    ]
    rows = world["session"].scalars(select(Regularisation)).all()
    assert len(rows) == 2 and {row.batch_id for row in rows} == {uuid.UUID(body["batch_id"])}
    assert all(row.is_direct for row in rows)
    assert status_of(world, "P-1") == "present" and status_of(world, "P-2") == "present"
    audit = (
        world["session"]
        .scalars(select(AuditLog).where(AuditLog.action == "attendance_correction.bulk_direct"))
        .one()
    )
    assert audit.after is not None and audit.after["count"] == 2 and audit.after["skipped"] == 1


def test_a_plant_head_asks_for_many_the_super_admin_approves_all_and_reverses_the_batch(
    world: dict,
) -> None:
    asked = world["head"].post(URL + "/bulk", json=bulk_body(world, ("P-1", "P-2")))
    batch = asked.json()["batch_id"]
    assert asked.status_code == 201 and asked.json()["created"] == 2
    pending = world["boss"].get(URL, params={"state": "pending"}).json()
    assert pending["total"] == 2 and status_of(world, "P-1") == "absent"

    approved = world["boss"].post(f"{URL}/batches/{batch}/approve-all", json={})
    again = world["boss"].post(f"{URL}/batches/{batch}/approve-all", json={})

    assert approved.json() == {"approved": 2, "failed": []}
    assert again.json() == {"approved": 0, "failed": []}  # nothing pending is not a failure
    assert status_of(world, "P-1") == "present" and status_of(world, "P-2") == "present"
    undone = world["boss"].post(
        f"{URL}/batches/{batch}/reverse", json={"reason": "The device had worked after all"}
    )
    assert undone.status_code == 201 and undone.json() == {"reversed": 2}
    assert status_of(world, "P-1") == "absent" and status_of(world, "P-2") == "absent"


def test_approve_all_lists_a_row_that_no_longer_fits(world: dict) -> None:
    batch = (
        world["head"].post(URL + "/bulk", json=bulk_body(world, ("P-1", "P-2"))).json()["batch_id"]
    )
    punch(world, "P-2", ist(THURSDAY, 9, 1), "in")  # P-2 punched in meanwhile

    result = world["boss"].post(f"{URL}/batches/{batch}/approve-all", json={}).json()

    assert result["approved"] == 1
    assert [item["code"] for item in result["failed"]] == ["CORRECTION_NO_LONGER_VALID"]


def test_limits_and_roles(world: dict) -> None:
    too_many = bulk_body(world) | {"employee_ids": [str(uuid.uuid4()) for _ in range(201)]}
    mixed = world["boss"].post(
        URL + "/bulk", json=bulk_body(world) | {"employee_ids": [str(world["foreigner"])]}
    )
    other_plant = world["other_head"].post(URL + "/bulk", json=bulk_body(world))
    cannot_approve = world["corporate"].post(f"{URL}/batches/{uuid.uuid4()}/approve-all", json={})
    unknown_batch = world["boss"].post(f"{URL}/batches/{uuid.uuid4()}/approve-all", json={})

    assert (
        world["boss"].post(URL + "/bulk", json=too_many).json()["error"]["code"] == "BULK_TOO_LARGE"
    )
    assert mixed.json()["error"]["code"] == "VALIDATION_FAILED"
    assert other_plant.json()["error"]["code"] == "NOT_FOUND"
    assert cannot_approve.json()["error"]["code"] == "FORBIDDEN"
    assert unknown_batch.json()["error"]["code"] == "NOT_FOUND"


def test_a_bulk_body_must_fit_its_kind(world: dict) -> None:
    broken = world["boss"].post(URL + "/bulk", json=bulk_body(world, out_time=None))

    assert broken.status_code == 422
