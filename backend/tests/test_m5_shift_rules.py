"""M5 shift rules, weekly off and attendance start date (spec §5.3, §7 rules 3, 4, 9, 11; AC-23).

Every test pins the date: shift rule versions depend on "today" in IST.
"""

import uuid
from datetime import time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.org.models import Shift
from app.modules.org.shift_rules_service import (
    apply_due_rule_versions,
    rule_version_on,
    shift_length_minutes,
    weekly_off_on,
)
from app.modules.users.models import Role
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.factories import log_in, make_user

NOON = ist(PINNED_DAY, 12, 0)


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


def create_plant(client: TestClient, code: str = "DEMO1") -> dict:
    response = client.post("/api/v1/plants", json={"name": f"Plant {code}", "code": code})
    assert response.status_code == 201, response.text
    return response.json()


def office_shift(client: TestClient, plant_id: str, **extra: object) -> dict:
    response = client.post(
        f"/api/v1/plants/{plant_id}/shifts",
        json={"name": "Office", "start_time": "09:00", "end_time": "17:00", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- Defaults and limits --------------------------------------------------------------------------


def test_new_plant_shift_has_the_m5_defaults_and_a_first_rule_version(boss: TestClient) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = boss.get(f"/api/v1/plants/{plant['id']}/shifts").json()[0]
        versions = boss.get(f"/api/v1/shifts/{shift['id']}/rule-versions").json()

    assert shift["grace_min"] == 30
    assert shift["overtime_min_minutes"] == 120
    assert shift["shift_length_min"] == 720
    assert shift["rules_from"] == PINNED_DAY.isoformat()
    assert shift["upcoming_rules"] is None
    assert "ot_after_min" not in shift
    assert [(v["effective_from"], v["grace_min"]) for v in versions] == [
        (PINNED_DAY.isoformat(), 30)
    ]


def test_an_old_client_sending_ot_after_min_is_ignored(boss: TestClient) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = office_shift(boss, plant["id"], ot_after_min=480)

    assert shift["grace_min"] == 30
    assert shift["half_day_min"] == 240
    assert shift["overtime_min_minutes"] == 120
    assert shift["shift_length_min"] == 480


@pytest.mark.parametrize(
    ("extra", "code"),
    [
        ({"half_day_min": 480}, "SHIFT_DAY_LIMITS_INVALID"),  # not below the 8 h full day
        ({"grace_min": 121}, "VALIDATION_FAILED"),
        ({"overtime_min_minutes": 481}, "VALIDATION_FAILED"),
    ],
)
def test_shift_limits_are_checked(boss: TestClient, extra: dict, code: str) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        response = boss.post(
            f"/api/v1/plants/{plant['id']}/shifts",
            json={"name": "Office", "start_time": "09:00", "end_time": "17:00", **extra},
        )

    assert response.json()["error"]["code"] == code


def test_changing_the_times_rechecks_the_half_day_against_the_new_length(
    boss: TestClient,
) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = office_shift(boss, plant["id"], half_day_min=300)
        response = boss.patch(f"/api/v1/shifts/{shift['id']}", json={"end_time": "13:00"})

    assert response.json()["error"]["code"] == "SHIFT_DAY_LIMITS_INVALID"
    assert response.json()["error"]["details"] == {"shift_length_min": 240}


def test_shift_length_of_day_and_night_shifts() -> None:
    assert shift_length_minutes(time(9), time(17)) == 480
    assert shift_length_minutes(time(19), time(7)) == 720


# --- Rule versions (AC-23) ----------------------------------------------------------------------


def test_rules_changed_from_a_later_date_keep_today_and_apply_from_that_date(
    boss: TestClient, db_session: Session
) -> None:
    later = PINNED_DAY + timedelta(days=8)  # 05/11/2026
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = office_shift(boss, plant["id"])
        changed = boss.patch(
            f"/api/v1/shifts/{shift['id']}",
            json={
                "end_time": "16:00",
                "half_day_min": 300,
                "grace_min": 15,
                "rules_effective_from": later.isoformat(),
            },
        )
        assert changed.status_code == 200, changed.text
        body = changed.json()

    shift_id = uuid.UUID(shift["id"])
    before = rule_version_on(db_session, shift_id, later - timedelta(days=1))
    after = rule_version_on(db_session, shift_id, later)
    assert before is not None and after is not None
    assert (before.end_time, before.grace_min, before.half_day_min) == (time(17), 30, 240)
    assert (after.end_time, after.grace_min, after.half_day_min) == (time(16), 15, 300)
    assert shift_length_minutes(after.start_time, after.end_time) == 420
    # Today the shift row and the screen still show the rules in force today.
    assert (body["end_time"], body["grace_min"]) == ("17:00:00", 30)
    assert body["upcoming_rules"]["effective_from"] == later.isoformat()
    assert body["upcoming_rules"]["shift_length_min"] == 420

    # On that date the daily job copies the version into the shift row.
    assert apply_due_rule_versions(db_session, later) == 1
    row = db_session.get(Shift, shift_id)
    assert row is not None and (row.end_time, row.grace_min) == (time(16), 15)
    assert apply_due_rule_versions(db_session, later) == 0


def test_two_saves_on_the_same_day_keep_both_and_the_latest_wins(
    boss: TestClient, db_session: Session
) -> None:
    """Decision 0036 line 1: rule versions are append-only, so a same-day fix adds a row."""
    with frozen_at(NOON, ticking=True):
        plant = create_plant(boss)
        shift = office_shift(boss, plant["id"])
        boss.patch(f"/api/v1/shifts/{shift['id']}", json={"grace_min": 20})
        fixed = boss.patch(f"/api/v1/shifts/{shift['id']}", json={"grace_min": 25}).json()
        versions = boss.get(f"/api/v1/shifts/{shift['id']}/rule-versions").json()

    current = rule_version_on(db_session, uuid.UUID(shift["id"]), PINNED_DAY)
    assert current is not None and current.grace_min == 25
    assert fixed["grace_min"] == 25
    assert [v["grace_min"] for v in versions] == [25, 20, 30]


def test_a_rename_adds_no_rule_version_and_a_past_date_is_refused(boss: TestClient) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = office_shift(boss, plant["id"])
        boss.patch(f"/api/v1/shifts/{shift['id']}", json={"name": "Office A"})
        past = boss.patch(
            f"/api/v1/shifts/{shift['id']}",
            json={"grace_min": 5, "rules_effective_from": "2026-10-27"},
        )
        versions = boss.get(f"/api/v1/shifts/{shift['id']}/rule-versions").json()

    assert past.json()["error"]["code"] == "SHIFT_RULE_DATE_INVALID"
    assert len(versions) == 1


def test_rule_versions_cannot_be_changed_or_deleted(boss: TestClient, db_session: Session) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = boss.get(f"/api/v1/plants/{plant['id']}/shifts").json()[0]

    for statement in (
        "UPDATE shift_rule_versions SET grace_min = 0 WHERE shift_id = :id",
        "DELETE FROM shift_rule_versions WHERE shift_id = :id",
    ):
        with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
            db_session.execute(text(statement), {"id": shift["id"]})


# --- Weekly off ----------------------------------------------------------------------------------


def test_new_plant_has_sunday_off_and_a_change_applies_from_its_date(
    boss: TestClient, db_session: Session
) -> None:
    next_week = PINNED_DAY + timedelta(days=7)
    with frozen_at(NOON):
        plant = create_plant(boss)
        url = f"/api/v1/plants/{plant['id']}/weekly-off"
        first = boss.get(url).json()
        created = boss.post(url, json={"weekday": 5, "effective_from": next_week.isoformat()})
        past = boss.post(url, json={"weekday": 5, "effective_from": "2026-10-27"})
        after = boss.get(url).json()

    assert first["current"]["weekday"] == 7
    assert created.status_code == 201
    assert created.json()["weekly_off"]["weekday"] == 5
    assert past.json()["error"]["code"] == "WEEKLY_OFF_DATE_INVALID"
    assert after["current"]["weekday"] == 7  # Friday only from next week
    assert [item["weekday"] for item in after["history"]] == [5, 7]
    plant_id = uuid.UUID(plant["id"])
    friday_rule = weekly_off_on(db_session, plant_id, next_week)
    assert friday_rule is not None and friday_rule.weekday == 5
    assert db_session.scalar(select(AuditLog.id).where(AuditLog.action == "plant.weekly_off_set"))


# --- Attendance start date and readiness ----------------------------------------------------------


def test_attendance_start_date_is_saved_audited_and_shown_in_readiness(
    boss: TestClient, db_session: Session
) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        before = boss.get(f"/api/v1/plants/{plant['id']}/readiness").json()
        updated = boss.patch(
            f"/api/v1/plants/{plant['id']}", json={"attendance_start_date": "2026-11-02"}
        )
        after = boss.get(f"/api/v1/plants/{plant['id']}/readiness").json()

    assert (before["attendance_start_set"], before["weekly_off_set"]) == (False, True)
    assert updated.json()["attendance_start_date"] == "2026-11-02"
    assert after["attendance_start_set"] is True
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "plant.attendance_start_set")
    ).one()
    assert audit.after == {"attendance_start_date": "2026-11-02"}


def test_a_plant_head_reads_the_rules_of_the_own_plant_but_cannot_change_them(
    boss: TestClient, db_client: TestClient, db_session: Session
) -> None:
    with frozen_at(NOON):
        plant = create_plant(boss)
        shift = boss.get(f"/api/v1/plants/{plant['id']}/shifts").json()[0]
        head = make_user(db_session, Role.PLANT_HEAD, username="head")
        set_user_plant(db_session, head, uuid.UUID(plant["id"]))
        db_session.commit()
        log_in(db_client, "head")

        versions = db_client.get(f"/api/v1/shifts/{shift['id']}/rule-versions")
        weekly_off = db_client.get(f"/api/v1/plants/{plant['id']}/weekly-off")
        change = db_client.post(
            f"/api/v1/plants/{plant['id']}/weekly-off",
            json={"weekday": 1, "effective_from": PINNED_DAY.isoformat()},
        )

    assert versions.status_code == 200
    assert weekly_off.status_code == 200
    assert change.json()["error"]["code"] == "FORBIDDEN"


def test_the_day_window_setting_must_leave_room_for_the_longest_shift(boss: TestClient) -> None:
    """Spec §7 rule 16: N must stay below 24 h minus the longest active shift."""
    with frozen_at(NOON):
        plant = create_plant(boss)
        office_shift(boss, plant["id"])
        fits = boss.put(
            "/api/v1/settings",
            json={"values": {"attendance_window_before_hours": 8}, "reason": "Early arrivals"},
        )
        boss.post(
            f"/api/v1/plants/{plant['id']}/shifts",
            json={"name": "Long", "start_time": "06:00", "end_time": "23:00"},  # 17 h
        )
        too_long = boss.put(
            "/api/v1/settings",
            json={"values": {"attendance_window_before_hours": 7}, "reason": "Early arrivals"},
        )

    assert fits.status_code == 200, fits.text
    assert too_long.json()["error"]["code"] == "SETTING_INVALID"
    assert too_long.json()["error"]["details"]["longest_shift_min"] == 1020
