"""QR cards: issue, replace, revoke, end date, lists, bulk, test cards, the database rules and
revoking a leaver's card (spec AC-1, AC-2, AC-5, AC-6, AC-30, AC-35)."""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import today_ist
from app.modules.audit.models import AuditLog
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.service import add_months
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import (
    PlantIds,
    client_for,
    create_plant,
    iso,
    permanent_body,
    temporary_body,
)

EMPLOYEES = "/api/v1/employees"
CARDS = "/api/v1/qr-cards"
TEST_CARDS = "/api/v1/qr-test-cards"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


def make_employee(client: TestClient, body: dict) -> dict:
    response = client.post(EMPLOYEES, json=body)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def worker(boss: TestClient, k134: PlantIds) -> dict:
    """A temporary worker: the punch method defaults to QR."""
    return make_employee(boss, temporary_body(k134))


def issue(client: TestClient, employee: dict, **body: str) -> dict:
    response = client.post(f"{EMPLOYEES}/{employee['id']}/qr-cards", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def head_of(db_app: FastAPI, db_session: Session, plant: PlantIds, username: str) -> TestClient:
    head = client_for(db_app, db_session, Role.PLANT_HEAD, username)
    user = db_session.scalars(select(User).where(User.username == username)).one()
    set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    return head


def audit_rows(db_session: Session, action: str) -> list[AuditLog]:
    return list(db_session.scalars(select(AuditLog).where(AuditLog.action == action)))


# --- Issue ------------------------------------------------------------------------------------


def test_issue_uses_the_defaults_and_writes_an_audit_entry(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    result = issue(boss, worker)
    card = result["card"]

    today = today_ist()
    assert card["serial"].startswith("C")
    assert len(card["serial"]) == 7
    assert card["valid_from"] == iso(today)
    # 2 months, minus the first day: 20/10/2026 → 19/12/2026
    assert card["valid_until"] == iso(add_months(today, 2) - timedelta(days=1))
    assert card["state"] == "active"
    assert card["print_count"] == 0
    assert card["printed_plant"] is None
    assert result["replaced_card"] is None
    assert len(audit_rows(db_session, "qr_card.issue")) == 1


def test_the_card_never_carries_the_qr_text_or_the_signature(
    boss: TestClient, worker: dict
) -> None:
    result = issue(boss, worker)

    assert "UPS1" not in str(result)
    assert "payload" not in str(result).lower()


def test_serials_come_from_one_counter_and_are_never_reused(
    boss: TestClient, k134: PlantIds
) -> None:
    first = make_employee(boss, temporary_body(k134, code="T-1", name="First Worker"))
    second = make_employee(boss, temporary_body(k134, code="T-2", name="Second Worker"))

    one = issue(boss, first)["card"]["serial"]
    test_card = boss.post(TEST_CARDS, json={"label": "Gate test"}).json()["serial"]
    two = issue(boss, second)["card"]["serial"]

    numbers = [int(serial[1:]) for serial in (one, test_card, two)]
    assert numbers == sorted(numbers)
    assert len(set(numbers)) == 3
    assert test_card.startswith("T")


def test_a_custom_start_and_end_date_are_used(boss: TestClient, worker: dict) -> None:
    start = today_ist() + timedelta(days=10)
    end = start + timedelta(days=100)

    card = issue(boss, worker, valid_from=iso(start), valid_until=iso(end))["card"]

    assert (card["valid_from"], card["valid_until"]) == (iso(start), iso(end))
    assert card["state"] == "not_yet_valid"


@pytest.mark.parametrize(
    "dates",
    [
        {"valid_from": "2020-01-01"},  # in the past
        {"valid_from": "2099-01-01"},  # more than 60 days ahead
        {"valid_until": "2020-01-01"},  # before the start
        {"valid_until": "2099-01-01"},  # longer than 3 years
    ],
)
def test_wrong_dates_are_refused(boss: TestClient, worker: dict, dates: dict) -> None:
    response = boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json=dates)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QR_VALIDITY_INVALID"


def test_an_employee_who_punches_by_face_gets_no_card(boss: TestClient, k134: PlantIds) -> None:
    staff = make_employee(boss, permanent_body(k134))

    response = boss.post(f"{EMPLOYEES}/{staff['id']}/qr-cards", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_QR"


def test_an_employee_who_left_gets_no_card(boss: TestClient, worker: dict) -> None:
    boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )

    response = boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={})

    assert response.json()["error"]["code"] == "EMPLOYEE_LEFT"


def test_without_a_signing_key_nothing_is_issued(
    boss: TestClient, worker: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("QR_SIGNING_KEY")
    get_settings.cache_clear()

    response = boss.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "QR_SIGNING_NOT_CONFIGURED"


# --- Replace and the one-card rule ------------------------------------------------------------


def test_a_new_card_revokes_the_old_one_in_the_same_step(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    old = issue(boss, worker)["card"]

    result = issue(boss, worker)

    new = result["card"]
    replaced = result["replaced_card"]
    assert replaced["id"] == old["id"]
    assert replaced["state"] == "revoked"
    assert replaced["revoke_kind"] == "replaced"
    assert replaced["revoke_reason"] == f"Replaced by {new['serial']}"
    history = boss.get(f"{EMPLOYEES}/{worker['id']}/qr-cards").json()["cards"]
    assert [card["state"] for card in history] == ["active", "revoked"]
    assert len(audit_rows(db_session, "qr_card.revoke")) == 1


def test_the_database_itself_allows_only_one_working_card(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    card = issue(boss, worker)["card"]
    first = db_session.get(QrCredential, uuid.UUID(card["id"]))
    assert first is not None

    duplicate = QrCredential(
        kind=CardKind.EMPLOYEE.value,
        employee_id=first.employee_id,
        card_serial="C999999",
        key_id="A",
        valid_from=first.valid_from,
        valid_until=first.valid_until,
        issued_by=first.issued_by,
        issued_at=first.issued_at,
        print_count=0,
    )
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(duplicate)
        db_session.flush()


@pytest.mark.parametrize(
    "broken_values",
    [
        # revoked_at without the other three revoke fields
        "revoked_at = now()",
        # employee card pretending to be a test card
        "kind = 'test'",
        # a serial that does not start with C for an employee card
        "card_serial = 'T000777'",
        # end before start
        "valid_until = valid_from - 1",
    ],
)
def test_the_database_refuses_inconsistent_cards(
    boss: TestClient, worker: dict, db_session: Session, broken_values: str
) -> None:
    card = issue(boss, worker)["card"]

    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            text(f"UPDATE qr_credentials SET {broken_values} WHERE id = :id"),  # noqa: S608 (fixed test strings)
            {"id": card["id"]},
        )


# --- Revoke and end date ----------------------------------------------------------------------


def test_revoking_stops_the_card_at_once_and_only_once(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    card = issue(boss, worker)["card"]

    revoked = boss.post(f"{CARDS}/{card['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})
    again = boss.post(f"{CARDS}/{card['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})

    body = revoked.json()
    assert (body["state"], body["revoke_kind"], body["revoke_reason"]) == (
        "revoked",
        "lost",
        "Lost it",
    )
    assert body["revoked_by"] is not None
    assert again.json()["error"]["code"] == "QR_CARD_REVOKED"
    assert len(audit_rows(db_session, "qr_card.revoke")) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "replaced", "reason": "Only the server may use this"},
        {"kind": "lost", "reason": "x"},
        {"kind": "stolen", "reason": "Not a known kind"},
    ],
)
def test_a_revoke_needs_a_known_kind_and_a_reason(
    boss: TestClient, worker: dict, body: dict
) -> None:
    card = issue(boss, worker)["card"]

    response = boss.post(f"{CARDS}/{card['id']}/revoke", json=body)

    assert response.status_code == 422


def test_the_end_date_can_be_extended_or_ended_today(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    card = issue(boss, worker)["card"]
    later = today_ist() + timedelta(days=400)

    extended = boss.patch(
        f"{CARDS}/{card['id']}", json={"valid_until": iso(later), "reason": "Contract renewed"}
    )
    ended = boss.patch(
        f"{CARDS}/{card['id']}", json={"valid_until": iso(today_ist()), "reason": "Ending it"}
    )

    assert extended.json()["valid_until"] == iso(later)
    # Today is the last working day, so the card still works and is "ending soon".
    assert ended.json()["valid_until"] == iso(today_ist())
    assert ended.json()["state"] == "expiring"
    assert len(audit_rows(db_session, "qr_card.update_validity")) == 2


@pytest.mark.parametrize("days", [-1, 2000])
def test_the_end_date_cannot_be_in_the_past_or_beyond_three_years(
    boss: TestClient, worker: dict, days: int
) -> None:
    card = issue(boss, worker)["card"]

    response = boss.patch(
        f"{CARDS}/{card['id']}",
        json={"valid_until": iso(today_ist() + timedelta(days=days)), "reason": "Testing"},
    )

    assert response.json()["error"]["code"] == "QR_VALIDITY_INVALID"


def test_a_revoked_card_keeps_its_end_date(boss: TestClient, worker: dict) -> None:
    card = issue(boss, worker)["card"]
    boss.post(f"{CARDS}/{card['id']}/revoke", json={"kind": "damaged", "reason": "Torn"})

    response = boss.patch(
        f"{CARDS}/{card['id']}",
        json={"valid_until": iso(today_ist() + timedelta(days=30)), "reason": "Extend it"},
    )

    assert response.json()["error"]["code"] == "QR_CARD_REVOKED"


def test_an_unknown_card_is_not_found(boss: TestClient) -> None:
    response = boss.post(
        f"{CARDS}/{uuid.uuid4()}/revoke", json={"kind": "lost", "reason": "No such card"}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "QR_CARD_NOT_FOUND"


# --- Marking an employee as left (FR-10) ------------------------------------------------------


def test_marking_an_employee_as_left_revokes_their_card_in_the_same_request(
    boss: TestClient, worker: dict, db_session: Session
) -> None:
    card = issue(boss, worker)["card"]

    boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )

    stored = db_session.get(QrCredential, uuid.UUID(card["id"]))
    assert stored is not None
    assert stored.revoke_kind == "left"
    left_audit = audit_rows(db_session, "employee.mark_left")[0]
    card_audit = audit_rows(db_session, "qr_card.revoke")[0]
    assert left_audit.request_id is not None
    assert left_audit.request_id == card_audit.request_id


def test_an_employee_without_a_card_can_still_be_marked_as_left(
    boss: TestClient, worker: dict
) -> None:
    response = boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )

    assert response.status_code == 200


def test_reactivating_does_not_bring_the_old_card_back(boss: TestClient, worker: dict) -> None:
    card = issue(boss, worker)["card"]
    boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )
    boss.post(
        f"{EMPLOYEES}/{worker['id']}/reactivate",
        json={"joined_on": iso(today_ist()), "reason": "Rejoined"},
    )

    history = boss.get(f"{EMPLOYEES}/{worker['id']}/qr-cards").json()["cards"]

    assert [(item["id"], item["state"]) for item in history] == [(card["id"], "revoked")]


# --- Roles and plant scope --------------------------------------------------------------------


def test_only_the_super_admin_may_change_cards(
    db_app: FastAPI, db_session: Session, boss: TestClient, worker: dict, k134: PlantIds
) -> None:
    card = issue(boss, worker)["card"]
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")
    plant_head = head_of(db_app, db_session, k134, "k134.head")

    for client in (corporate, plant_head):
        for response in (
            client.post(f"{EMPLOYEES}/{worker['id']}/qr-cards", json={}),
            client.patch(
                f"{CARDS}/{card['id']}", json={"valid_until": "2030-01-01", "reason": "x y z"}
            ),
            client.post(f"{CARDS}/{card['id']}/revoke", json={"kind": "lost", "reason": "x y z"}),
            client.post(
                f"{CARDS}/bulk",
                json={"action": "issue", "employee_ids": [worker["id"]], "reason": "x y z"},
            ),
            client.get(f"{CARDS}/expiring-count"),
            client.get(TEST_CARDS),
            client.post(TEST_CARDS, json={"label": "Not allowed"}),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "FORBIDDEN"


def test_corporate_head_reads_every_plant_and_plant_head_only_their_own(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds, tp1: PlantIds
) -> None:
    mine = make_employee(boss, temporary_body(k134, code="T-1", name="Own Plant"))
    other = make_employee(boss, temporary_body(tp1, code="T-2", name="Other Plant"))
    issue(boss, mine)
    issue(boss, other)
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")
    plant_head = head_of(db_app, db_session, k134, "k134.head")

    everyone = corporate.get(CARDS).json()
    own_only = plant_head.get(CARDS).json()

    assert everyone["total"] == 2
    assert [item["employee"]["code"] for item in own_only["items"]] == ["T-1"]
    assert plant_head.get(f"{EMPLOYEES}/{mine['id']}/qr-cards").status_code == 200
    refused = plant_head.get(f"{EMPLOYEES}/{other['id']}/qr-cards")
    assert refused.status_code == 404
    assert refused.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


# --- The list ---------------------------------------------------------------------------------


def test_the_list_shows_every_active_employee_with_the_state_of_their_latest_card(
    boss: TestClient, k134: PlantIds
) -> None:
    with_card = make_employee(boss, temporary_body(k134, code="T-1", name="Has Card"))
    make_employee(boss, temporary_body(k134, code="T-2", name="No Card"))
    revoked = make_employee(boss, temporary_body(k134, code="T-3", name="Lost Card"))
    issue(boss, with_card)
    lost = issue(boss, revoked)["card"]
    boss.post(f"{CARDS}/{lost['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})

    items = boss.get(CARDS).json()["items"]

    states = {item["employee"]["code"]: (item["card"] or {}).get("state") for item in items}
    assert states == {"T-1": "active", "T-2": None, "T-3": "revoked"}


@pytest.mark.parametrize(
    ("state", "expected_codes"),
    [("none", ["T-2"]), ("active", ["T-1"]), ("revoked", ["T-3"]), ("expired", [])],
)
def test_the_list_filters_by_card_state(
    boss: TestClient, k134: PlantIds, state: str, expected_codes: list[str]
) -> None:
    one = make_employee(boss, temporary_body(k134, code="T-1", name="Has Card"))
    make_employee(boss, temporary_body(k134, code="T-2", name="No Card"))
    three = make_employee(boss, temporary_body(k134, code="T-3", name="Lost Card"))
    issue(boss, one)
    lost = issue(boss, three)["card"]
    boss.post(f"{CARDS}/{lost['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})

    items = boss.get(CARDS, params={"state": state}).json()["items"]

    assert [item["employee"]["code"] for item in items] == expected_codes


def test_the_list_finds_a_card_by_serial_name_or_code(boss: TestClient, k134: PlantIds) -> None:
    one = make_employee(boss, temporary_body(k134, code="T-1", name="Sunil More"))
    make_employee(boss, temporary_body(k134, code="T-2", name="Other Person"))
    serial = issue(boss, one)["card"]["serial"]

    for query in (serial, serial.lower(), "sunil", "T-1"):
        items = boss.get(CARDS, params={"q": query}).json()["items"]
        assert [item["employee"]["code"] for item in items] == ["T-1"], query


def test_the_list_marks_a_card_that_needs_a_reprint(
    boss: TestClient, k134: PlantIds, tp1: PlantIds, worker: dict, db_session: Session
) -> None:
    card = issue(boss, worker)["card"]
    stored = db_session.get(QrCredential, uuid.UUID(card["id"]))
    assert stored is not None
    stored.printed_plant_id = uuid.UUID(tp1.id)  # the card was printed for another plant
    db_session.commit()

    flagged = boss.get(CARDS, params={"reprint_needed": "true"}).json()["items"]

    assert [item["employee"]["code"] for item in flagged] == ["T-2041"]
    assert flagged[0]["card"]["reprint_needed"] is True
    assert flagged[0]["card"]["printed_plant"]["code"] == "TP1"


def test_the_list_leaves_out_employees_who_left(boss: TestClient, worker: dict) -> None:
    boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )

    assert boss.get(CARDS).json()["total"] == 0


def test_cards_ending_soon_are_counted(boss: TestClient, k134: PlantIds) -> None:
    soon = make_employee(boss, temporary_body(k134, code="T-1", name="Ends Soon"))
    later = make_employee(boss, temporary_body(k134, code="T-2", name="Ends Later"))
    ends_in_ten_days = iso(today_ist() + timedelta(days=10))
    issue(boss, soon, valid_until=ends_in_ten_days)
    issue(boss, later)

    counted = boss.get(f"{CARDS}/expiring-count").json()

    assert counted == {"count": 1, "days": 14}


# --- Bulk -------------------------------------------------------------------------------------


def test_bulk_issue_skips_and_lists_who_cannot_get_a_card(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    workers = [
        make_employee(boss, temporary_body(k134, code=f"T-{number}", name=f"Worker {number}"))
        for number in range(1, 13)
    ]
    for already_carded in workers[:3]:
        issue(boss, already_carded)
    face = make_employee(boss, permanent_body(k134, code="1001", name="Face Employee"))

    response = boss.post(
        f"{CARDS}/bulk",
        json={
            "action": "issue",
            "employee_ids": [worker["id"] for worker in workers] + [face["id"]],
            "reason": "New batch",
        },
    )

    body = response.json()
    assert body["done"] == 9
    # the answer names exactly the nine new cards, so the screen can print them
    assert len(body["card_ids"]) == 9
    listed = boss.get(CARDS, params={"q": "T-", "page_size": 50}).json()["items"]
    new_ids = {item["card"]["id"] for item in listed if item["card"]} & set(body["card_ids"])
    assert new_ids == set(body["card_ids"])
    skipped = {(row["employee_code"], row["code"]) for row in body["skipped"]}
    assert skipped == {
        ("T-1", "QR_CARD_EXISTS"),
        ("T-2", "QR_CARD_EXISTS"),
        ("T-3", "QR_CARD_EXISTS"),
        ("1001", "EMPLOYEE_NOT_QR"),
    }
    # bulk issue never replaces a working card: the three old cards are still the only ones
    history = boss.get(f"{EMPLOYEES}/{workers[0]['id']}/qr-cards").json()["cards"]
    assert [card["state"] for card in history] == ["active"]
    entries = audit_rows(db_session, "qr_card.issue")
    assert len(entries) == 12  # 3 single + 9 bulk, one audit entry per card


def test_bulk_revoke_uses_one_request_id_and_lists_cards_already_revoked(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    cards = []
    for number in range(1, 4):
        employee = make_employee(
            boss, temporary_body(k134, code=f"T-{number}", name=f"Worker {number}")
        )
        cards.append(issue(boss, employee)["card"])
    boss.post(f"{CARDS}/{cards[0]['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})
    before = len(audit_rows(db_session, "qr_card.revoke"))

    response = boss.post(
        f"{CARDS}/bulk",
        json={
            "action": "revoke",
            "card_ids": [card["id"] for card in cards],
            "kind": "other",
            "reason": "Batch ended",
        },
    )

    body = response.json()
    assert body["done"] == 2
    assert body["card_ids"] == []
    assert [(row["card_serial"], row["code"]) for row in body["skipped"]] == [
        (cards[0]["serial"], "QR_CARD_REVOKED")
    ]
    new_entries = audit_rows(db_session, "qr_card.revoke")[before:]
    assert len(new_entries) == 2
    assert len({entry.request_id for entry in new_entries}) == 1


def test_bulk_revoke_needs_a_kind(boss: TestClient, worker: dict) -> None:
    card = issue(boss, worker)["card"]

    response = boss.post(
        f"{CARDS}/bulk", json={"action": "revoke", "card_ids": [card["id"]], "reason": "No kind"}
    )

    assert response.status_code == 422


def test_bulk_stops_when_too_many_rows_are_sent(boss: TestClient) -> None:
    response = boss.post(
        f"{CARDS}/bulk",
        json={
            "action": "issue",
            "employee_ids": [str(uuid.uuid4()) for _ in range(501)],
            "reason": "Too many",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "BULK_TOO_LARGE"


# --- Test cards (F-27) ------------------------------------------------------------------------


def test_a_test_card_can_be_made_listed_and_revoked(boss: TestClient, db_session: Session) -> None:
    created = boss.post(TEST_CARDS, json={"label": "Gate test K134"})
    card = created.json()

    listed = boss.get(TEST_CARDS).json()
    revoked = boss.post(f"{TEST_CARDS}/{card['id']}/revoke", json={"reason": "Lost at the gate"})

    assert created.status_code == 201
    assert card["serial"].startswith("T")
    assert card["label"] == "Gate test K134"
    assert card["valid_until"] == "2099-12-31"
    assert [item["id"] for item in listed] == [card["id"]]
    assert revoked.json()["state"] == "revoked"
    assert len(audit_rows(db_session, "qr_test_card.issue")) == 1
    assert len(audit_rows(db_session, "qr_test_card.revoke")) == 1


def test_test_cards_stay_out_of_the_employee_list_and_the_test_revoke_refuses_an_employee_card(
    boss: TestClient, worker: dict
) -> None:
    boss.post(TEST_CARDS, json={"label": "Gate test"})
    card = issue(boss, worker)["card"]

    items = boss.get(CARDS).json()["items"]
    refused = boss.post(f"{TEST_CARDS}/{card['id']}/revoke", json={"reason": "Wrong endpoint"})

    assert [item["employee"]["code"] for item in items] == ["T-2041"]
    assert refused.status_code == 404
    assert refused.json()["error"]["code"] == "QR_CARD_NOT_FOUND"


def test_a_test_card_has_no_changeable_end_date(boss: TestClient) -> None:
    card = boss.post(TEST_CARDS, json={"label": "Gate test"}).json()

    response = boss.patch(
        f"{CARDS}/{card['id']}", json={"valid_until": iso(today_ist()), "reason": "Try it"}
    )

    assert response.json()["error"]["code"] == "QR_VALIDITY_INVALID"


# --- Quick search by card serial (F-6, step 5) ------------------------------------------------

SEARCH = "/api/v1/search"


def found(client: TestClient, text: str) -> list[dict]:
    response = client.get(SEARCH, params={"q": text})
    assert response.status_code == 200, response.text
    return response.json()["employees"]


def test_typing_a_card_serial_finds_its_owner_and_says_which_serial_matched(
    boss: TestClient, worker: dict
) -> None:
    serial = issue(boss, worker)["card"]["serial"]

    for typed in (serial, serial.lower(), f"  {serial} "):
        employees = found(boss, typed)
        assert [employee["employee_code"] for employee in employees] == ["T-2041"], typed
        assert employees[0]["card_serial"] == serial


def test_the_start_of_a_serial_finds_the_owner_from_four_characters_on(
    boss: TestClient, worker: dict
) -> None:
    serial = issue(boss, worker)["card"]["serial"]  # for example C000001

    assert [e["employee_code"] for e in found(boss, serial[:5])] == ["T-2041"]
    assert [e["employee_code"] for e in found(boss, serial[:4])] == ["T-2041"]
    # "C00" is too short to mean a card, so it is not guessed
    assert found(boss, serial[:3]) == []


def test_an_old_replaced_card_still_leads_to_its_owner(boss: TestClient, worker: dict) -> None:
    old = issue(boss, worker)["card"]["serial"]
    new = issue(boss, worker)["card"]["serial"]

    assert found(boss, old)[0]["card_serial"] == old
    assert found(boss, new)[0]["card_serial"] == new


def test_a_search_by_name_or_code_has_no_card_serial(boss: TestClient, worker: dict) -> None:
    issue(boss, worker)

    by_name = found(boss, "sunil")
    by_code = found(boss, "T-20")

    assert [e["card_serial"] for e in by_name + by_code] == [None, None]


def test_a_test_card_serial_or_an_unknown_serial_finds_nobody(
    boss: TestClient, worker: dict
) -> None:
    issue(boss, worker)
    test_serial = boss.post(TEST_CARDS, json={"label": "Gate test"}).json()["serial"]

    assert found(boss, test_serial) == []
    assert found(boss, "C999999") == []


def test_the_owner_is_found_even_after_they_left(boss: TestClient, worker: dict) -> None:
    serial = issue(boss, worker)["card"]["serial"]
    boss.post(
        f"{EMPLOYEES}/{worker['id']}/mark-left",
        json={"left_on": iso(today_ist()), "reason": "Contract ended"},
    )

    employees = found(boss, serial)

    assert [(e["employee_code"], e["status"]) for e in employees] == [("T-2041", "left")]


def test_a_plant_head_finds_only_cards_of_their_own_plant(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds, tp1: PlantIds
) -> None:
    mine = make_employee(boss, temporary_body(k134, code="T-1", name="Own Plant"))
    other = make_employee(boss, temporary_body(tp1, code="T-2", name="Other Plant"))
    my_serial = issue(boss, mine)["card"]["serial"]
    other_serial = issue(boss, other)["card"]["serial"]
    plant_head = head_of(db_app, db_session, k134, "k134.head")

    assert [e["employee_code"] for e in found(plant_head, my_serial)] == ["T-1"]
    assert found(plant_head, other_serial) == []  # another plant: it looks like it does not exist
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")
    assert [e["employee_code"] for e in found(corporate, other_serial)] == ["T-2"]
