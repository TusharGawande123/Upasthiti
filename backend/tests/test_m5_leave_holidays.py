"""M5 leave entry and holiday calendar (spec §5.3, §7 rules 4 and 12, §9; AC-12 list, AC-18, AC-20).

Every test pins the clock to Wed 28/10/2026 12:00 IST.
"""

import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.factories import log_in, make_user
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body


@pytest.fixture(autouse=True)
def pinned_clock() -> Iterator[None]:
    with frozen_at(ist(PINNED_DAY, 12, 0)):
        yield


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


@pytest.fixture
def plant(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "DEMO1")


@pytest.fixture
def employee(boss: TestClient, plant: PlantIds) -> dict:
    response = boss.post("/api/v1/employees", json=permanent_body(plant))
    assert response.status_code == 201, response.text
    return response.json()


def add_leave(client: TestClient, employee_id: str, start: str, end: str, **extra: object):
    return client.post(
        "/api/v1/leave",
        json={
            "employee_id": employee_id,
            "from_date": start,
            "to_date": end,
            "is_paid": True,
            "reason": "Family function",
            **extra,
        },
    )


# --- Leave ----------------------------------------------------------------------------------------


def test_leave_over_a_sunday_counts_only_the_working_days(boss: TestClient, employee: dict) -> None:
    """E18: paid leave Sat 31/10 – Mon 02/11 → 2 working days (Sunday 01/11 is the weekly off)."""
    created = add_leave(boss, employee["id"], "2026-10-31", "2026-11-02")

    assert created.status_code == 201, created.text
    leave = created.json()["leave"]
    assert leave["working_days"] == 2
    assert leave["reason"] == "Family function"
    assert leave["employee"]["code"] == "1043"


def test_a_holiday_inside_the_leave_is_not_a_leave_day(
    boss: TestClient, employee: dict, plant: PlantIds
) -> None:
    boss.post(
        "/api/v1/holidays",
        json={"date": "2026-11-02", "name": "Local festival", "all_plants": True},
    )

    leave = add_leave(boss, employee["id"], "2026-10-30", "2026-11-03").json()["leave"]

    # Fri 30, Sat 31 and Tue 03 are working; Sun 01 is the weekly off; Mon 02 the holiday.
    assert leave["working_days"] == 3


@pytest.mark.parametrize(
    ("start", "end", "code"),
    [
        ("2026-11-05", "2026-11-04", "LEAVE_RANGE_INVALID"),  # to before from
        ("2026-11-01", "2027-02-01", "LEAVE_RANGE_INVALID"),  # 93 days
        ("2026-01-01", "2026-01-20", "LEAVE_RANGE_INVALID"),  # before joining (15/01/2026)
    ],
)
def test_leave_ranges_are_checked(
    boss: TestClient, employee: dict, start: str, end: str, code: str
) -> None:
    assert add_leave(boss, employee["id"], start, end).json()["error"]["code"] == code


def test_ninety_two_days_is_the_longest_leave(boss: TestClient, employee: dict) -> None:
    assert add_leave(boss, employee["id"], "2026-11-01", "2027-01-31").status_code == 201


def test_overlapping_leave_is_refused_until_the_first_is_cancelled(
    boss: TestClient, employee: dict, db_session: Session
) -> None:
    first = add_leave(boss, employee["id"], "2026-11-02", "2026-11-04").json()["leave"]
    overlap = add_leave(boss, employee["id"], "2026-11-04", "2026-11-06")
    cancelled = boss.post(f"/api/v1/leave/{first['id']}/cancel", json={"reason": "Plans changed"})
    again = boss.post(f"/api/v1/leave/{first['id']}/cancel", json={"reason": "Plans changed"})
    after_cancel = add_leave(boss, employee["id"], "2026-11-04", "2026-11-06")

    assert overlap.status_code == 409
    assert overlap.json()["error"] == {
        "code": "LEAVE_OVERLAPS",
        "message": "Leave already exists for part of these dates.",
        "details": {"leave_id": first["id"]},
    }
    assert cancelled.json()["leave"]["cancelled"]["reason"] == "Plans changed"
    assert again.json()["error"]["code"] == "LEAVE_NOT_ACTIVE"
    assert after_cancel.status_code == 201
    actions = set(
        db_session.scalars(select(AuditLog.action).where(AuditLog.entity_type == "leave"))
    )
    assert actions == {"leave.create", "leave.cancel"}


def test_leave_list_filters_and_hides_reasons_from_other_roles(
    boss: TestClient, employee: dict, db_app: FastAPI, db_session: Session, plant: PlantIds
) -> None:
    add_leave(boss, employee["id"], "2026-10-30", "2026-10-30", is_paid=False)
    add_leave(boss, employee["id"], "2026-12-01", "2026-12-02")
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")

    october = boss.get("/api/v1/leave", params={"month": "2026-10"}).json()
    unpaid = boss.get("/api/v1/leave", params={"is_paid": "false"}).json()
    seen_by_corporate = corporate.get("/api/v1/leave").json()

    assert [item["from_date"] for item in october["items"]] == ["2026-10-30"]
    assert unpaid["total"] == 1
    assert seen_by_corporate["total"] == 2
    assert {item["reason"] for item in seen_by_corporate["items"]} == {None}


def test_a_plant_head_sees_only_the_own_plants_leave(
    boss: TestClient, employee: dict, db_app: FastAPI, db_session: Session, plant: PlantIds
) -> None:
    other = create_plant(boss, db_session, "DEMO2")
    add_leave(boss, employee["id"], "2026-11-02", "2026-11-02")
    own_head = client_for(db_app, db_session, Role.PLANT_HEAD, "own_head")
    other_head = client_for(db_app, db_session, Role.PLANT_HEAD, "other_head")
    for username, plant_id in (("own_head", plant.id), ("other_head", other.id)):
        user = db_session.scalars(select(User).where(User.username == username)).one()
        set_user_plant(db_session, user, uuid.UUID(plant_id))
    db_session.commit()

    assert own_head.get("/api/v1/leave").json()["total"] == 1
    assert other_head.get("/api/v1/leave").json()["total"] == 0


def test_only_the_super_admin_enters_leave_and_holidays(
    employee: dict, db_app: FastAPI, db_session: Session
) -> None:
    """AC-18: the Corporate Head may read but not change leave or holidays."""
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")

    leave = add_leave(corporate, employee["id"], "2026-11-02", "2026-11-02")
    holiday = corporate.post(
        "/api/v1/holidays",
        json={"date": "2026-11-10", "name": "Foundation day", "all_plants": True},
    )

    assert leave.json()["error"]["code"] == "FORBIDDEN"
    assert holiday.json()["error"]["code"] == "FORBIDDEN"


# --- Holidays ----------------------------------------------------------------------------------


def test_holidays_for_all_plants_and_for_chosen_plants(
    boss: TestClient, plant: PlantIds, db_session: Session
) -> None:
    other = create_plant(boss, db_session, "DEMO2")
    everyone = boss.post(
        "/api/v1/holidays",
        json={"date": "2026-11-10", "name": "Foundation day", "all_plants": True},
    )
    only_other = boss.post(
        "/api/v1/holidays",
        json={
            "date": "2026-11-12",
            "name": "Local fair",
            "all_plants": False,
            "plant_ids": [other.id],
            "is_paid": False,
        },
    )

    assert everyone.status_code == 201, everyone.text
    assert only_other.json()["holiday"]["plants"] == [{"id": other.id, "code": "DEMO2"}]
    assert only_other.json()["holiday"]["is_paid"] is False
    listed = boss.get("/api/v1/holidays", params={"year": 2026, "plant_id": plant.id}).json()
    assert [holiday["name"] for holiday in listed] == ["Foundation day"]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"date": "2025-10-27", "name": "Too old", "all_plants": True}, "HOLIDAY_DATE_INVALID"),
        ({"date": "2028-10-29", "name": "Too far", "all_plants": True}, "HOLIDAY_DATE_INVALID"),
        ({"date": "2026-11-10", "name": "No plant", "all_plants": False}, "VALIDATION_FAILED"),
        ({"date": "2026-11-10", "name": "X", "all_plants": True}, "VALIDATION_FAILED"),
    ],
)
def test_holiday_input_is_checked(boss: TestClient, body: dict, code: str) -> None:
    assert boss.post("/api/v1/holidays", json=body).json()["error"]["code"] == code


def test_a_second_holiday_on_the_same_date_and_plant_is_refused(
    boss: TestClient, plant: PlantIds
) -> None:
    first = boss.post(
        "/api/v1/holidays",
        json={"date": "2026-11-10", "name": "Fair", "all_plants": False, "plant_ids": [plant.id]},
    ).json()["holiday"]
    clash = boss.post(
        "/api/v1/holidays", json={"date": "2026-11-10", "name": "Foundation", "all_plants": True}
    )
    boss.post(f"/api/v1/holidays/{first['id']}/cancel", json={"reason": "Moved to Friday"})
    after_cancel = boss.post(
        "/api/v1/holidays", json={"date": "2026-11-10", "name": "Foundation", "all_plants": True}
    )

    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "HOLIDAY_EXISTS"
    assert clash.json()["error"]["details"]["plant_codes"] == ["DEMO1"]
    assert after_cancel.status_code == 201
    cancelled = boss.get("/api/v1/holidays", params={"year": 2026, "state": "cancelled"}).json()
    assert [holiday["cancelled"]["reason"] for holiday in cancelled] == ["Moved to Friday"]


def test_a_past_holiday_can_be_added_within_a_year(boss: TestClient) -> None:
    """A sudden closure last week is entered afterwards (spec §7 rule 4)."""
    response = boss.post(
        "/api/v1/holidays", json={"date": "2026-10-20", "name": "Power cut", "all_plants": True}
    )

    assert response.status_code == 201


def test_cancelling_twice_says_not_active(boss: TestClient) -> None:
    holiday = boss.post(
        "/api/v1/holidays", json={"date": "2026-11-10", "name": "Foundation", "all_plants": True}
    ).json()["holiday"]
    boss.post(f"/api/v1/holidays/{holiday['id']}/cancel", json={"reason": "Wrong date"})

    again = boss.post(f"/api/v1/holidays/{holiday['id']}/cancel", json={"reason": "Wrong date"})

    assert again.json()["error"]["code"] == "HOLIDAY_NOT_ACTIVE"


# --- Database rules (AC-20) --------------------------------------------------------------------


def test_leave_and_holidays_can_be_cancelled_once_but_never_changed_or_deleted(
    boss: TestClient, employee: dict, db_session: Session
) -> None:
    leave = add_leave(boss, employee["id"], "2026-11-02", "2026-11-02").json()["leave"]
    holiday = boss.post(
        "/api/v1/holidays", json={"date": "2026-11-10", "name": "Foundation", "all_plants": True}
    ).json()["holiday"]

    for statement in (
        "UPDATE leave_records SET is_paid = false WHERE id = :leave",
        "DELETE FROM leave_records WHERE id = :leave",
        "UPDATE holidays SET name = 'Other' WHERE id = :holiday",
        "DELETE FROM holidays WHERE id = :holiday",
    ):
        with pytest.raises(DBAPIError, match="only be cancelled"), db_session.begin_nested():
            db_session.execute(text(statement), {"leave": leave["id"], "holiday": holiday["id"]})

    boss.post(f"/api/v1/leave/{leave['id']}/cancel", json={"reason": "Not needed"})
    with pytest.raises(DBAPIError, match="only be cancelled"), db_session.begin_nested():
        db_session.execute(
            text("UPDATE leave_records SET cancel_reason = 'Changed later' WHERE id = :leave"),
            {"leave": leave["id"]},
        )
