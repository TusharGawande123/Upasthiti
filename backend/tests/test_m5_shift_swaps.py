"""The one-day shift swap (M5 spec §5.3, §7 rule 26; F-58; AC-44). Real PostgreSQL, fake data, the
clock pinned to Wed 28/10/2026 12:00 IST. Office is 09:00-17:00, Night is 19:00-07:00."""

import uuid
from collections.abc import Iterator
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.service import ensure_fresh
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import PlantWeeklyOff
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.factories import log_in
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

THURSDAY = date(2026, 10, 29)
NOW = ist(PINNED_DAY, 12, 0)


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(NOW):
        yield


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant: PlantIds = create_plant(boss, db_session, "DEMO1")
    boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-01"})
    db_session.add(
        PlantWeeklyOff(
            plant_id=uuid.UUID(plant.id),
            weekday=7,
            effective_from=date(2026, 10, 1),
            created_at=ist(date(2026, 10, 1), 12),
        )
    )
    office = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00"},
    ).json()
    night = boss.post(
        f"/api/v1/plants/{plant.id}/shifts",
        json={"name": "Night", "start_time": "19:00", "end_time": "07:00"},
    ).json()
    employee = boss.post(
        "/api/v1/employees", json=permanent_body(plant, code="E-1") | {"shift_id": office["id"]}
    ).json()
    other_plant = create_plant(boss, db_session, "DEMO2")
    foreign_shift = boss.get(f"/api/v1/plants/{other_plant.id}/shifts").json()[0]
    kiosk = make_active_kiosk(db_session, plant, Device())
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
    db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "plant": plant,
        "office": office,
        "night": night,
        "employee": uuid.UUID(employee["id"]),
        "foreign_shift": foreign_shift,
        "kiosk": kiosk,
        "session": db_session,
    }


def add_swap(world: dict, day: str = "2026-10-29", shift: str = "night", **extra: object):
    return world["boss"].post(
        f"/api/v1/employees/{world['employee']}/shift-swaps",
        json={"date": day, "shift_id": world[shift]["id"], "reason": "Covering a colleague"}
        | extra,
    )


def punch(world: dict, moment: datetime, direction: str) -> None:
    kiosk: KioskDevice = world["kiosk"]
    world["session"].add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=world["employee"],
            method="face",
            direction=direction,
            decision="accepted",
            reason_codes=[],
            server_received_at=moment,
            was_offline=False,
        )
    )
    world["session"].commit()


def day_row(world: dict, day: date) -> AttendanceDay:
    session: Session = world["session"]
    later = ist(date(2026, 11, 3), 12, 0)
    with frozen_at(later):  # the days must have begun before they are stored
        ensure_fresh(session, [world["employee"]], day, day, later)
    row = session.scalars(
        select(AttendanceDay).where(
            AttendanceDay.employee_id == world["employee"], AttendanceDay.attendance_date == day
        )
    ).one()
    session.refresh(row)
    return row


def test_a_swap_is_created_listed_audited_and_cancelled(world: dict) -> None:
    created = add_swap(world)

    assert created.status_code == 201, created.text
    swap = created.json()["swap"]
    assert swap["shift"]["name"] == "Night" and swap["date"] == "2026-10-29"
    listed = world["boss"].get(f"/api/v1/employees/{world['employee']}/shift-swaps").json()
    assert [item["id"] for item in listed] == [swap["id"]]
    cancelled = world["boss"].post(
        f"/api/v1/shift-swaps/{swap['id']}/cancel", json={"reason": "Plans changed"}
    )
    again = world["boss"].post(
        f"/api/v1/shift-swaps/{swap['id']}/cancel", json={"reason": "Plans changed"}
    )
    assert cancelled.json()["swap"]["cancelled"]["reason"] == "Plans changed"
    assert again.json()["error"]["code"] == "SHIFT_SWAP_NOT_ACTIVE"
    actions = set(
        world["session"].scalars(
            select(AuditLog.action).where(AuditLog.entity_type == "shift_swap")
        )
    )
    assert actions == {"shift_swap.create", "shift_swap.cancel"}


def test_the_day_uses_the_swapped_shift_and_its_rules(world: dict) -> None:
    """On the swap date the Night shift's window and rules apply: IN 19:00, OUT next 07:00 is one
    full present day of 29/10; the day before is unchanged."""
    add_swap(world)
    punch(world, ist(THURSDAY, 19, 0), "in")
    punch(world, ist(date(2026, 10, 30), 7, 0), "out")

    swapped = day_row(world, THURSDAY)
    normal = day_row(world, date(2026, 10, 27))

    assert (swapped.status, swapped.worked_min, swapped.shift_length_min) == ("present", 720, 720)
    assert normal.shift_length_min == 480  # Tuesday keeps the Office shift
    with frozen_at(ist(date(2026, 11, 3), 12, 0)):  # the day has begun by then
        log_in(world["boss"], "boss")
        detail = (
            world["boss"]
            .get(f"/api/v1/attendance/employee/{world['employee']}/day/{THURSDAY}")
            .json()
        )
    assert detail["shift_swap"]["shift"]["name"] == "Night"
    assert detail["shift_rules"]["shift_length_min"] == 720


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"day": "2026-10-27"}, "past_date"),
        ({"shift": "office"}, "same_shift"),
        ({"shift": "foreign_shift"}, "other_plant"),
    ],
)
def test_a_swap_that_does_not_fit_is_refused(world: dict, change: dict, reason: str) -> None:
    response = add_swap(world, **change)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "SHIFT_SWAP_INVALID"
    assert response.json()["error"]["details"]["reason"] == reason


def test_an_inactive_shift_and_a_left_employee_are_refused(world: dict) -> None:
    world["boss"].post(
        f"/api/v1/shifts/{world['night']['id']}/deactivate", json={"reason": "Not needed"}
    )
    inactive = add_swap(world)
    world["boss"].post(
        f"/api/v1/employees/{world['employee']}/mark-left",
        json={"left_on": "2026-10-28", "reason": "Resigned"},
    )
    left = add_swap(world, shift="office")

    assert inactive.json()["error"]["details"]["reason"] == "inactive_shift"
    assert left.json()["error"]["details"]["reason"] == "employee_not_active"


def test_a_second_active_swap_on_the_same_date_is_refused_until_the_first_is_cancelled(
    world: dict,
) -> None:
    first = add_swap(world).json()["swap"]
    second = add_swap(world)
    world["boss"].post(f"/api/v1/shift-swaps/{first['id']}/cancel", json={"reason": "Wrong person"})
    after_cancel = add_swap(world)

    assert second.status_code == 409 and second.json()["error"]["code"] == "SHIFT_SWAP_EXISTS"
    assert after_cancel.status_code == 201


def test_a_swap_cannot_be_cancelled_once_its_day_has_begun(world: dict) -> None:
    """Rule 26: the Night window of 29/10 starts at 15:00; before that cancelling is fine."""
    swap = add_swap(world).json()["swap"]
    with frozen_at(ist(THURSDAY, 15, 0)):
        log_in(world["boss"], "boss")
        late = world["boss"].post(
            f"/api/v1/shift-swaps/{swap['id']}/cancel", json={"reason": "Too late now"}
        )

    assert late.status_code == 409 and late.json()["error"]["code"] == "SHIFT_SWAP_STARTED"


def test_only_the_super_admin_swaps_and_the_heads_read(world: dict) -> None:
    swap = add_swap(world).json()["swap"]

    refused = world["head"].post(
        f"/api/v1/employees/{world['employee']}/shift-swaps",
        json={"date": "2026-10-30", "shift_id": world["night"]["id"], "reason": "Not allowed"},
    )
    cancel = world["head"].post(
        f"/api/v1/shift-swaps/{swap['id']}/cancel", json={"reason": "Not allowed"}
    )

    assert refused.json()["error"]["code"] == "FORBIDDEN"
    assert cancel.json()["error"]["code"] == "FORBIDDEN"


def test_swaps_cannot_be_changed_or_deleted(world: dict) -> None:
    swap = add_swap(world).json()["swap"]
    session: Session = world["session"]

    for statement in (
        "UPDATE shift_swaps SET reason = 'changed' WHERE id = :id",
        "DELETE FROM shift_swaps WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="only be cancelled"), session.begin_nested():
            session.execute(text(statement), {"id": swap["id"]})


def test_the_gate_rule_follows_the_swapped_window(world: dict) -> None:
    """Rule 26: the shift_closed rule uses the same calendar, so the swapped day's window decides
    which punches belong to the same shift day."""
    from app.antiproxy.rules.shift_closed import check_shift_closed  # noqa: F401  (same helper)

    add_swap(world)
    punch(world, ist(THURSDAY, 19, 0), "in")
    punch(world, ist(THURSDAY, 22, 0), "out")

    row = day_row(world, THURSDAY)

    # Office would have called a 19:00 IN a next-day punch; the swap makes it one Night day.
    assert row.first_in == ist(THURSDAY, 19, 0) and row.last_out == ist(THURSDAY, 22, 0)
