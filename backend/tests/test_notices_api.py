"""Gate notices: create, list, change and end, with every role (spec M2 §5.4, §7 rule 11,
F-25; AC-31). Real PostgreSQL; fake data only."""

import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.notices.queries import visible_notices
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import PlantIds, client_for, create_plant

NOTICES = "/api/v1/notices"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


@pytest.fixture
def corporate(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")


@pytest.fixture
def head(db_app: FastAPI, db_session: Session, k134: PlantIds) -> TestClient:
    client = client_for(db_app, db_session, Role.PLANT_HEAD, "head.k134")
    user = db_session.scalars(select(User).where(User.username == "head.k134")).one()
    set_user_plant(db_session, user, uuid.UUID(k134.id))
    db_session.commit()
    return client


def iso(moment: datetime) -> str:
    return moment.isoformat()


def body(plant: PlantIds | None, **changes: object) -> dict:
    now = utc_now()
    values: dict[str, object] = {
        "plant_id": plant.id if plant else None,
        "text": "Gate 2 is closed for repair until 14:00.",
        "level": "normal",
        "starts_at": iso(now - timedelta(minutes=5)),
        "ends_at": iso(now + timedelta(hours=8)),
    }
    return values | changes


def create(client: TestClient, plant: PlantIds | None, **changes: object) -> dict:
    response = client.post(NOTICES, json=body(plant, **changes))
    assert response.status_code == 201, response.text
    return response.json()


def error_code(response) -> str:
    return response.json()["error"]["code"]


def audits(session: Session, action: str) -> list[AuditLog]:
    return list(session.scalars(select(AuditLog).where(AuditLog.action == action)))


# --- Creating -----------------------------------------------------------------------------------


def test_the_super_admin_writes_a_notice_for_one_plant_and_it_is_audited(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    notice = create(boss, k134, text="  Canteen timing today: 12:30 to 13:15.  ", level="important")

    assert notice["text"] == "Canteen timing today: 12:30 to 13:15."  # trimmed
    assert notice["plant"]["code"] == "K134"
    assert notice["level"] == "important"
    assert notice["state"] == "showing"
    assert notice["created_by"]["name"] == "Test super_admin"
    assert notice["can_change"] is True
    (entry,) = audits(db_session, "notice.create")
    assert str(entry.plant_id) == k134.id
    assert entry.after is not None and entry.after["text"] == notice["text"]


def test_the_super_admin_writes_a_notice_for_every_plant(boss: TestClient, k134: PlantIds) -> None:
    notice = create(boss, None)

    assert notice["plant"] is None


def test_a_notice_starting_later_is_scheduled(boss: TestClient, k134: PlantIds) -> None:
    later = utc_now() + timedelta(days=1)
    notice = create(boss, k134, starts_at=iso(later), ends_at=iso(later + timedelta(hours=2)))

    assert notice["state"] == "scheduled"


def test_a_plant_head_writes_only_for_their_own_plant(
    head: TestClient, k134: PlantIds, tp1: PlantIds
) -> None:
    assert create(head, k134)["can_change"] is True
    assert error_code(head.post(NOTICES, json=body(tp1))) == "NOT_FOUND"
    assert error_code(head.post(NOTICES, json=body(None))) == "FORBIDDEN"


def test_the_corporate_head_cannot_write_notices(corporate: TestClient, k134: PlantIds) -> None:
    assert error_code(corporate.post(NOTICES, json=body(k134))) == "FORBIDDEN"


@pytest.mark.parametrize("text", ["", "   ", "x" * 201, "First line\nsecond line", "Tab\there"])
def test_text_must_be_1_to_200_characters_on_one_line(
    boss: TestClient, k134: PlantIds, text: str
) -> None:
    assert error_code(boss.post(NOTICES, json=body(k134, text=text))) == "NOTICE_TEXT_INVALID"


def test_200_characters_and_html_like_text_are_kept_as_typed(
    boss: TestClient, k134: PlantIds
) -> None:
    assert len(create(boss, k134, text="x" * 200)["text"]) == 200
    # Shown as plain text on the kiosk, never as markup: stored exactly as typed.
    assert create(boss, k134, text="<b>Safety</b> first")["text"] == "<b>Safety</b> first"
    assert create(boss, k134, text="गेट २ बंद आहे")["text"] == "गेट २ बंद आहे"


def test_the_dates_must_make_sense(boss: TestClient, k134: PlantIds) -> None:
    now = utc_now()
    cases = [
        {"starts_at": iso(now + timedelta(hours=2)), "ends_at": iso(now + timedelta(hours=1))},
        {"starts_at": iso(now), "ends_at": iso(now)},
        {"starts_at": iso(now), "ends_at": iso(now + timedelta(days=90, minutes=1))},
        {"starts_at": iso(now - timedelta(days=2)), "ends_at": iso(now - timedelta(days=1))},
        {"starts_at": "2026-10-20T08:00:00", "ends_at": "2026-12-20T08:00:00"},  # no time zone
    ]
    for dates in cases:
        assert error_code(boss.post(NOTICES, json=body(k134, **dates))) == "NOTICE_DATES_INVALID"

    longest = create(boss, k134, starts_at=iso(now), ends_at=iso(now + timedelta(days=90)))
    assert longest["state"] == "showing"


# --- Reading ------------------------------------------------------------------------------------


def texts(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {item["text"] for item in response.json()["items"]}


@pytest.fixture
def notices(boss: TestClient, k134: PlantIds, tp1: PlantIds) -> dict:
    later = utc_now() + timedelta(days=2)
    made = {
        "k134": create(boss, k134, text="For K134"),
        "tp1": create(boss, tp1, text="For TP1"),
        "all": create(boss, None, text="For everyone"),
        "later": create(
            boss,
            k134,
            text="Next week",
            starts_at=iso(later),
            ends_at=iso(later + timedelta(hours=1)),
        ),
        "ended": create(boss, k134, text="Old news"),
    }
    assert boss.post(f"{NOTICES}/{made['ended']['id']}/end").status_code == 200
    return made


def test_the_super_admin_and_corporate_head_see_every_notice(
    boss: TestClient, corporate: TestClient, notices: dict
) -> None:
    every = {"For K134", "For TP1", "For everyone", "Next week", "Old news"}
    assert texts(boss.get(NOTICES)) == every
    assert texts(corporate.get(NOTICES)) == every
    assert all(item["can_change"] is False for item in corporate.get(NOTICES).json()["items"])


def test_a_plant_head_sees_own_plant_and_all_plant_notices_but_changes_only_their_own(
    head: TestClient, notices: dict
) -> None:
    items = {item["text"]: item for item in head.get(NOTICES).json()["items"]}

    assert set(items) == {"For K134", "For everyone", "Next week", "Old news"}
    assert items["For K134"]["can_change"] is True
    assert items["For everyone"]["can_change"] is False


def test_notices_filter_by_state_plant_and_all_plants(
    boss: TestClient, notices: dict, k134: PlantIds
) -> None:
    assert texts(boss.get(NOTICES, params={"state": "showing"})) == {
        "For K134",
        "For TP1",
        "For everyone",
    }
    assert texts(boss.get(NOTICES, params={"state": "scheduled"})) == {"Next week"}
    assert texts(boss.get(NOTICES, params={"state": "ended"})) == {"Old news"}
    assert texts(boss.get(NOTICES, params={"plant_id": k134.id})) == {
        "For K134",
        "Next week",
        "Old news",
    }
    assert texts(boss.get(NOTICES, params={"all_plants": "true"})) == {"For everyone"}


def test_the_notice_list_needs_a_login(db_client: TestClient) -> None:
    assert db_client.get(NOTICES).status_code == 401


# --- Changing and ending ------------------------------------------------------------------------


def test_a_notice_can_be_changed_and_the_change_is_audited(
    boss: TestClient, db_session: Session, notices: dict
) -> None:
    notice_id = notices["k134"]["id"]
    new_end = utc_now() + timedelta(days=3)

    changed = boss.patch(
        f"{NOTICES}/{notice_id}",
        json={"text": "Gate 2 open again.", "level": "important", "ends_at": iso(new_end)},
    ).json()

    assert (changed["text"], changed["level"]) == ("Gate 2 open again.", "important")
    (entry,) = audits(db_session, "notice.update")
    assert entry.before is not None and entry.before["text"] == "For K134"
    assert entry.after is not None and entry.after["text"] == "Gate 2 open again."


def test_a_change_must_still_follow_the_text_and_date_rules(
    boss: TestClient, notices: dict
) -> None:
    url = f"{NOTICES}/{notices['k134']['id']}"
    assert error_code(boss.patch(url, json={"text": ""})) == "NOTICE_TEXT_INVALID"
    too_long = iso(utc_now() + timedelta(days=200))
    assert error_code(boss.patch(url, json={"ends_at": too_long})) == "NOTICE_DATES_INVALID"


def test_a_plant_head_cannot_change_or_end_an_all_plant_or_other_plant_notice(
    head: TestClient, notices: dict
) -> None:
    every_plant = notices["all"]["id"]
    assert error_code(head.patch(f"{NOTICES}/{every_plant}", json={"text": "x"})) == "FORBIDDEN"
    assert error_code(head.post(f"{NOTICES}/{every_plant}/end")) == "FORBIDDEN"
    assert error_code(head.post(f"{NOTICES}/{notices['tp1']['id']}/end")) == "NOT_FOUND"


def test_a_plant_head_ends_their_own_notice(head: TestClient, notices: dict) -> None:
    ended = head.post(f"{NOTICES}/{notices['k134']['id']}/end").json()

    assert ended["state"] == "ended"
    assert ended["ended_by"]["name"] == "Test plant_head"


def test_ending_is_audited_and_an_ended_notice_cannot_change(
    boss: TestClient, db_session: Session, notices: dict
) -> None:
    ended_id = notices["ended"]["id"]

    assert len(audits(db_session, "notice.end")) == 1
    assert error_code(boss.post(f"{NOTICES}/{ended_id}/end")) == "NOTICE_ENDED"
    assert error_code(boss.patch(f"{NOTICES}/{ended_id}", json={"text": "again"})) == "NOTICE_ENDED"


def test_an_ended_notice_leaves_the_kiosk_at_once(
    boss: TestClient, db_session: Session, notices: dict, k134: PlantIds
) -> None:
    shown = {n.text for n in visible_notices(db_session, uuid.UUID(k134.id), utc_now())}

    assert shown == {"For K134", "For everyone"}  # not the scheduled one, not the ended one
    boss.post(f"{NOTICES}/{notices['k134']['id']}/end")
    assert {n.text for n in visible_notices(db_session, uuid.UUID(k134.id), utc_now())} == {
        "For everyone"
    }


def test_an_unknown_notice_is_not_found(boss: TestClient, k134: PlantIds) -> None:
    assert error_code(boss.post(f"{NOTICES}/{uuid.uuid4()}/end")) == "NOT_FOUND"
