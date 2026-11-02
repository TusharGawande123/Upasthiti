"""The alert jobs (M5 spec §7 rules 19 and 20; F-4, F-62, F-65; AC-32, AC-34, AC-35, AC-48).
Real PostgreSQL, fake data, times pinned. Every job is run twice: a repeat must change nothing."""

import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.attendance.service import close_recent_days
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.notifications.alerts import (
    purge_old_notifications,
    run_five_minute_alerts,
    run_morning_alerts,
)
from app.modules.notifications.models import Notification
from app.modules.org.models import PlantWeeklyOff
from app.modules.punches.models import Punch
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import frozen_at, ist
from tests.factories import log_in
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

THURSDAY = date(2026, 10, 29)


def make_plant(boss: TestClient, session: Session, code: str) -> PlantIds:
    plant = create_plant(boss, session, code)
    boss.patch(f"/api/v1/plants/{plant.id}", json={"attendance_start_date": "2026-10-26"})
    session.add(
        PlantWeeklyOff(
            plant_id=uuid.UUID(plant.id),
            weekday=7,
            effective_from=date(2026, 10, 1),
            created_at=ist(date(2026, 10, 1), 12),
        )
    )
    session.commit()
    return plant


@pytest.fixture
def world(db_app: FastAPI, db_session: Session) -> dict:
    with frozen_at(ist(THURSDAY, 6, 0)):
        boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
        plant = make_plant(boss, db_session, "K134")
        demo = make_plant(boss, db_session, "DEMO1")
        people = {}
        for code in ("P-1", "P-2", "P-3"):
            body = permanent_body(plant, code=code, name=f"Person {code}") | {
                "joined_on": "2026-10-26"
            }
            people[code] = uuid.UUID(boss.post("/api/v1/employees", json=body).json()["id"])
        demo_person = boss.post(
            "/api/v1/employees", json=permanent_body(demo, code="D-1") | {"joined_on": "2026-10-26"}
        ).json()
        kiosk = make_active_kiosk(db_session, plant, Device())
        demo_kiosk = make_active_kiosk(db_session, demo, Device())
        head = client_for(db_app, db_session, Role.PLANT_HEAD, "head")
        user = db_session.scalars(select(User).where(User.username == "head")).one()
        set_user_plant(db_session, user, uuid.UUID(plant.id))
        db_session.commit()
    return {
        "boss": boss,
        "head": head,
        "plant": plant,
        "people": people,
        "demo_person": uuid.UUID(demo_person["id"]),
        "kiosk": kiosk,
        "demo_kiosk": demo_kiosk,
        "session": db_session,
    }


def punch(
    world: dict, code: str | uuid.UUID, moment: datetime, direction: str, *, demo: bool = False
) -> None:
    kiosk: KioskDevice = world["demo_kiosk" if demo else "kiosk"]
    employee = world["demo_person"] if demo else world["people"][code]
    world["session"].add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=employee,
            method="face",
            direction=direction,
            decision="accepted",
            reason_codes=[],
            server_received_at=moment,
            was_offline=False,
        )
    )
    world["session"].commit()


def notifications(world: dict, kind: str | None = None) -> list[Notification]:
    statement = select(Notification).order_by(Notification.created_at)
    if kind:
        statement = statement.where(Notification.kind == kind)
    return list(world["session"].scalars(statement))


def run_twice(job, world: dict, now: datetime) -> None:  # noqa: ANN001
    job(world["session"], now)
    job(world["session"], now)  # a repeat changes nothing (dedupe keys)


# --- Still inside (F-4) -------------------------------------------------------------------------


def test_people_still_inside_an_hour_after_the_shift_raise_one_urgent_alert(world: dict) -> None:
    punch(world, "P-1", ist(THURSDAY, 8, 0), "in")
    punch(world, "P-2", ist(THURSDAY, 8, 5), "in")
    punch(world, "P-3", ist(THURSDAY, 8, 10), "in")
    punch(world, "P-3", ist(THURSDAY, 17, 0), "out")
    punch(world, "D-1", ist(THURSDAY, 8, 0), "in", demo=True)  # a demo plant never alerts

    early = ist(THURSDAY, 19, 30)  # the shift ended 19:00; the alert waits until 20:00
    run_twice(run_five_minute_alerts, world, early)
    assert notifications(world, "still_inside") == []

    run_twice(run_five_minute_alerts, world, ist(THURSDAY, 20, 5))

    (alert,) = notifications(world, "still_inside")
    assert alert.severity == "urgent" and alert.resolved_at is None
    assert alert.params["count"] == 2 and alert.params["plant"] == "K134"
    assert len(alert.subject_ids) == 2 and "Person" not in str(alert.params)  # ids, never names
    assert alert.link.startswith("/admin/muster")
    # The plant head sees it; the count follows while it is open, and it resolves when empty.
    punch(world, "P-1", ist(THURSDAY, 20, 10), "out")
    run_five_minute_alerts(world["session"], ist(THURSDAY, 20, 15))
    world["session"].refresh(alert)
    assert alert.params["count"] == 1 and alert.resolved_at is None
    punch(world, "P-2", ist(THURSDAY, 20, 20), "out")
    run_five_minute_alerts(world["session"], ist(THURSDAY, 20, 25))
    world["session"].refresh(alert)
    assert alert.resolved_at is not None


# --- Many rejections ----------------------------------------------------------------------------


def test_many_refused_punches_at_one_device_raise_an_alert_but_cool_down_scans_do_not(
    world: dict,
) -> None:
    kiosk: KioskDevice = world["kiosk"]
    now = ist(THURSDAY, 11, 0)

    def refuse(code: str, minutes_ago: int) -> None:
        world["session"].add(
            Punch(
                client_punch_id=uuid.uuid4(),
                kiosk_id=kiosk.id,
                plant_id=kiosk.plant_id,
                method="face",
                decision="rejected",
                reason_codes=[code],
                server_received_at=now - timedelta(minutes=minutes_ago),
                was_offline=False,
            )
        )

    for number in range(9):
        refuse("FACE_NOT_RECOGNISED", number)
    for number in range(20):
        refuse("COOLDOWN_ACTIVE", number)  # double scans: never counted (decision 0027)
    world["session"].commit()
    run_twice(run_five_minute_alerts, world, now)
    assert notifications(world, "many_rejections") == []

    refuse("SPOOF_SUSPECTED", 10)  # the tenth real refusal
    world["session"].commit()
    run_twice(run_five_minute_alerts, world, now)

    (alert,) = notifications(world, "many_rejections")
    assert alert.params["count"] == 10 and alert.subject_ids == [kiosk.id]


# --- Device offline -----------------------------------------------------------------------------


def test_a_device_offline_during_the_shift_alerts_once_and_resolves_when_back(world: dict) -> None:
    kiosk: KioskDevice = world["kiosk"]
    now = ist(THURSDAY, 10, 0)
    kiosk.last_seen_at = now - timedelta(minutes=30)
    world["session"].commit()

    run_twice(run_five_minute_alerts, world, now)

    (alert,) = notifications(world, "device_offline")
    assert alert.severity == "warning" and alert.subject_ids == [kiosk.id]
    assert alert.params["device"] == kiosk.name and alert.resolved_at is None
    kiosk.last_seen_at = now + timedelta(minutes=1)  # it is back
    world["session"].commit()
    run_five_minute_alerts(world["session"], now + timedelta(minutes=2))
    world["session"].refresh(alert)
    assert alert.resolved_at is not None


# --- Every morning ------------------------------------------------------------------------------


def morning(world: dict, day: date) -> datetime:
    now = ist(day, 7, 30)
    close_recent_days(world["session"], now)  # the 00:05 close comes before the morning job
    return now


def test_the_morning_alerts_incomplete_days_the_digest_and_the_streak(world: dict) -> None:
    """AC-9 / F-62: one incomplete day, a punch in the review list, and an absence streak."""
    punch(world, "P-1", ist(date(2026, 10, 28), 9, 0), "in")
    punch(world, "P-1", ist(date(2026, 10, 28), 17, 0), "out")  # breaks P-1's streak
    punch(world, "P-3", ist(date(2026, 10, 29), 9, 0), "in")  # no OUT on Thursday: Incomplete
    with frozen_at(ist(THURSDAY, 7, 0)):
        log_in(world["boss"], "boss")  # the 06:00 login of the fixture is long idle
        leave = world["boss"].post(
            "/api/v1/leave",
            json={
                "employee_id": str(world["people"]["P-2"]),
                "from_date": "2026-10-27",
                "to_date": "2026-10-27",
                "is_paid": True,
                "reason": "Family function",
            },
        )
    assert leave.status_code == 201, leave.text
    friday = date(2026, 10, 30)
    now = morning(world, friday)

    run_twice(run_morning_alerts, world, now)

    incomplete = notifications(world, "incomplete_days")
    assert [(item.params["count"], item.params["plant"]) for item in incomplete] == [(1, "K134")]
    streaks = notifications(world, "absence_streak")
    # P-1 broke it on Wednesday and P-3 came on Thursday; P-2 was on leave Tuesday, so the run is
    # only Wednesday and Thursday (2 < 3): nobody has a streak yet.
    assert streaks == []
    run_twice(run_morning_alerts, world, morning(world, date(2026, 10, 31)))
    # P-2: Wed 28, Thu 29, Fri 30 are absent: 3 in a row now (Tuesday's leave ends the run).
    (streak,) = notifications(world, "absence_streak")
    assert streak.params["count"] == 3 and streak.params["since"] == "2026-10-28"
    assert streak.subject_ids == [world["people"]["P-2"]]
    # The streak goes on the next days without a second notification (one per streak).
    run_morning_alerts(world["session"], morning(world, date(2026, 11, 2)))
    # (P-1, absent Thursday to Saturday, rightly starts a streak of its own.)
    second_day = [
        item
        for item in notifications(world, "absence_streak")
        if item.subject_ids == [world["people"]["P-2"]]
    ]
    assert len(second_day) == 1
    with frozen_at(ist(date(2026, 11, 2), 8, 0)):
        log_in(world["head"], "head")
        seen = world["head"].get("/api/v1/notifications").json()
    assert {item["kind"] for item in seen["items"]} == {
        "incomplete_days",
        "absence_streak",
        "monthly_register",  # it is the 2nd of the month
    }


def test_a_weekly_off_does_not_break_a_streak(world: dict) -> None:
    """Mon 26 to Sat 31 are working days, Sun 1/11 the weekly off: P-2 and P-3 (absent every day)
    keep one run across it. P-1 works every day."""
    for day in range(26, 32):
        punch(world, "P-1", ist(date(2026, 10, day), 9, 0), "in")
        punch(world, "P-1", ist(date(2026, 10, day), 17, 0), "out")
    now = morning(world, date(2026, 11, 2))

    run_morning_alerts(world["session"], now)

    streaks = {item.subject_ids[0]: item for item in notifications(world, "absence_streak")}
    assert set(streaks) == {world["people"]["P-2"], world["people"]["P-3"]}
    assert streaks[world["people"]["P-2"]].params["count"] == 6  # not cut at the Sunday


def test_the_register_notice_comes_only_on_the_second_of_the_month(world: dict) -> None:
    run_morning_alerts(world["session"], morning(world, date(2026, 11, 3)))
    assert notifications(world, "monthly_register") == []

    now = morning(world, date(2026, 11, 2))
    run_twice(run_morning_alerts, world, now)

    (notice,) = notifications(world, "monthly_register")
    assert notice.params["month"] == "October 2026" and notice.params["plant"] == "K134"
    assert notice.link == f"/admin/attendance/register?month=2026-10&plant_id={world['plant'].id}"


def test_the_review_digest_is_made_when_something_waits(world: dict) -> None:
    kiosk: KioskDevice = world["kiosk"]
    world["session"].add(
        Punch(
            client_punch_id=uuid.uuid4(),
            kiosk_id=kiosk.id,
            plant_id=kiosk.plant_id,
            employee_id=world["people"]["P-1"],
            method="face",
            direction="in",
            decision="flagged",
            reason_codes=["LOCATION_AT_EDGE"],
            server_received_at=ist(THURSDAY, 9, 0),
            was_offline=False,
        )
    )
    world["session"].commit()

    run_twice(run_morning_alerts, world, morning(world, date(2026, 10, 30)))

    (digest,) = notifications(world, "review_digest")
    assert digest.params["flagged"] == 1 and digest.plant_id is None


# --- Every night --------------------------------------------------------------------------------


def test_old_notifications_are_deleted_after_the_keep_days(world: dict) -> None:
    now = ist(date(2026, 12, 1), 0, 5)
    old = Notification(
        kind="device_offline",
        severity="warning",
        plant_id=None,
        text_key="notification.device_offline",
        params={},
        subject_ids=[],
        link="/admin/kiosks",
        dedupe_key="old-one",
        created_at=now - timedelta(days=91),
    )
    fresh = Notification(
        kind="device_offline",
        severity="warning",
        plant_id=None,
        text_key="notification.device_offline",
        params={},
        subject_ids=[],
        link="/admin/kiosks",
        dedupe_key="fresh-one",
        created_at=now - timedelta(days=89),
    )
    world["session"].add_all([old, fresh])
    world["session"].commit()

    deleted = purge_old_notifications(world["session"], now)

    assert deleted == 1
    assert [item.dedupe_key for item in notifications(world)] == ["fresh-one"]
    assert world["session"].get(Employee, world["people"]["P-1"]) is not None  # records stay
