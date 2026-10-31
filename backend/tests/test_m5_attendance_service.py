"""Stored attendance days: marking stale, recomputing, carry-over and the catch-up (M5 spec §7 rule
14; AC-4, AC-25). Real PostgreSQL, fake data, the clock pinned."""

import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.service import (
    close_recent_days,
    ensure_fresh,
    recompute_stale,
)
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

NOW = ist(PINNED_DAY, 12, 0)  # Wed 28/10/2026 12:00 IST
THURSDAY = date(2026, 10, 29)


@pytest.fixture
def setup(
    db_app: FastAPI, db_session: Session
) -> tuple[TestClient, PlantIds, KioskDevice, uuid.UUID]:
    with frozen_at(NOW):
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant = create_plant(boss, db_session, "DEMO1")
        boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-01"})
        # 09:00–17:00 with grace 30: the default 07:00–19:00 shift is replaced for the test.
        shift = boss.post(
            f"/api/v1/plants/{plant.id}/shifts",
            json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
        ).json()
        body = permanent_body(plant, code="E-1") | {"shift_id": shift["id"]}
        employee = boss.post("/api/v1/employees", json=body).json()
        kiosk = make_active_kiosk(db_session, plant, Device())
    return boss, plant, kiosk, uuid.UUID(employee["id"])


def add_punch(
    session: Session, kiosk: KioskDevice, employee_id: uuid.UUID, moment: datetime, direction: str
) -> Punch:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=employee_id,
        method="face",
        direction=direction,
        decision="accepted",
        reason_codes=[],
        server_received_at=moment,
        was_offline=False,
    )
    session.add(punch)
    session.flush()
    return punch


def day_row(session: Session, employee_id: uuid.UUID, day: date) -> AttendanceDay:
    row = session.scalars(
        select(AttendanceDay).where(
            AttendanceDay.employee_id == employee_id, AttendanceDay.attendance_date == day
        )
    ).one()
    session.refresh(row)
    return row


def test_a_read_creates_and_computes_the_days_of_a_range(setup: tuple, db_session: Session) -> None:
    _boss, _plant, kiosk, employee_id = setup
    add_punch(db_session, kiosk, employee_id, ist(date(2026, 10, 27), 9, 25), "in")
    add_punch(db_session, kiosk, employee_id, ist(date(2026, 10, 27), 17, 0), "out")

    with frozen_at(NOW):
        ensure_fresh(db_session, [employee_id], date(2026, 10, 25), date(2026, 10, 28), NOW)

    tuesday = day_row(db_session, employee_id, date(2026, 10, 27))
    assert (tuesday.status, tuesday.status_min, tuesday.worked_min) == ("present", 480, 455)
    assert tuesday.stale is False and tuesday.calc_version == 1
    assert day_row(db_session, employee_id, date(2026, 10, 26)).status == "absent"  # Monday
    today = day_row(db_session, employee_id, PINNED_DAY)
    assert (today.status) == "open"  # today, 12:00: nobody has punched


def test_a_punch_marks_its_days_stale_and_the_catch_up_recomputes_them(
    setup: tuple, db_session: Session
) -> None:
    _boss, _plant, kiosk, employee_id = setup
    with frozen_at(NOW):
        ensure_fresh(db_session, [employee_id], date(2026, 10, 26), date(2026, 10, 27), NOW)
        assert day_row(db_session, employee_id, date(2026, 10, 27)).status == "absent"

        from app.modules.attendance.service import mark_punch_stale

        punch = add_punch(db_session, kiosk, employee_id, ist(date(2026, 10, 27), 9, 0), "in")
        mark_punch_stale(db_session, punch)
        db_session.commit()
        assert day_row(db_session, employee_id, date(2026, 10, 27)).stale is True

        recomputed = recompute_stale(db_session, NOW)

    assert recomputed >= 1
    row = day_row(db_session, employee_id, date(2026, 10, 27))
    assert row.stale is False
    assert row.status == "incomplete"  # IN but no OUT: the day closed


def test_the_carried_over_out_belongs_to_the_day_of_the_in(
    setup: tuple, db_session: Session
) -> None:
    """AC-4 (E19): IN 29/10 10:00, OUT 30/10 05:30 is one day, with no OUT_WITHOUT_IN on 30/10."""
    _boss, _plant, kiosk, employee_id = setup
    add_punch(db_session, kiosk, employee_id, ist(THURSDAY, 10, 0), "in")
    add_punch(db_session, kiosk, employee_id, ist(THURSDAY + timedelta(days=1), 5, 30), "out")
    far_now = ist(date(2026, 11, 3), 12, 0)

    with frozen_at(far_now):
        ensure_fresh(db_session, [employee_id], THURSDAY, date(2026, 10, 31), far_now)

    thursday = day_row(db_session, employee_id, THURSDAY)
    friday = day_row(db_session, employee_id, THURSDAY + timedelta(days=1))
    assert (thursday.status, thursday.worked_min, thursday.overtime_min) == ("half_day", 1170, 750)
    assert friday.status == "absent"
    assert "OUT_WITHOUT_IN" not in friday.exceptions


def test_an_out_after_twenty_hours_is_not_carried_over(setup: tuple, db_session: Session) -> None:
    _boss, _plant, kiosk, employee_id = setup
    add_punch(db_session, kiosk, employee_id, ist(THURSDAY, 10, 0), "in")
    add_punch(db_session, kiosk, employee_id, ist(THURSDAY + timedelta(days=1), 6, 10), "out")
    far_now = ist(date(2026, 11, 3), 12, 0)

    with frozen_at(far_now):
        ensure_fresh(db_session, [employee_id], THURSDAY, date(2026, 10, 31), far_now)

    assert day_row(db_session, employee_id, THURSDAY).status == "incomplete"
    friday = day_row(db_session, employee_id, THURSDAY + timedelta(days=1))
    assert friday.status == "incomplete" and "OUT_WITHOUT_IN" in friday.exceptions


def test_the_nightly_close_creates_a_row_for_every_active_employee(
    setup: tuple, db_session: Session
) -> None:
    _boss, _plant, _kiosk, employee_id = setup
    with frozen_at(ist(date(2026, 10, 29), 0, 5)):
        stored = close_recent_days(db_session, ist(date(2026, 10, 29), 0, 5))
        again = close_recent_days(db_session, ist(date(2026, 10, 29), 0, 5))

    assert stored >= 1
    assert again >= 0  # safe to repeat
    assert day_row(db_session, employee_id, PINNED_DAY).status in {"absent", "open"}


def test_a_new_calc_version_makes_every_row_old(setup: tuple, db_session: Session) -> None:
    """AC-25: changing ATTENDANCE_CALC_VERSION makes the catch-up job recompute old rows."""
    _boss, _plant, _kiosk, employee_id = setup
    with frozen_at(NOW):
        ensure_fresh(db_session, [employee_id], date(2026, 10, 26), date(2026, 10, 27), NOW)
        row = day_row(db_session, employee_id, date(2026, 10, 27))
        db_session.execute(
            update(AttendanceDay)
            .where(AttendanceDay.id == row.id)
            .values(calc_version=0, status="present")
        )
        db_session.commit()
        recompute_stale(db_session, NOW)

    fixed = day_row(db_session, employee_id, date(2026, 10, 27))
    assert (fixed.status, fixed.calc_version) == ("absent", 1)
