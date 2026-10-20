"""Printing cards through the API: who may print, what is counted and audited, the plant on the
card, and that the QR in the PDF is the one the server signs (spec AC-4, AC-5, AC-30)."""

import uuid

import pypdfium2 as pdfium
import pytest
import zxingcpp
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import today_ist
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import build_payload
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import PlantIds, client_for, create_plant, temporary_body

EMPLOYEES = "/api/v1/employees"
CARDS = "/api/v1/qr-cards"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def new_card(client: TestClient, plant: PlantIds, number: int) -> dict:
    employee = client.post(
        EMPLOYEES,
        json=temporary_body(plant, code=f"T-{number}", name=f"Worker Number {number}"),
    )
    assert employee.status_code == 201, employee.text
    issued = client.post(f"{EMPLOYEES}/{employee.json()['id']}/qr-cards", json={})
    assert issued.status_code == 201, issued.text
    return issued.json()["card"]


def stored(db_session: Session, card: dict) -> QrCredential:
    db_session.expire_all()
    row = db_session.get(QrCredential, uuid.UUID(card["id"]))
    assert row is not None
    return row


def pdf_pages(response_content: bytes) -> list:
    return list(pdfium.PdfDocument(response_content))


def scanned_texts(response_content: bytes) -> list[str]:
    texts: list[str] = []
    for page in pdf_pages(response_content):
        image = page.render(scale=2).to_pil()
        texts += [barcode.text for barcode in zxingcpp.read_barcodes(image)]
    return texts


# --- One card ---------------------------------------------------------------------------------


def test_a_single_card_downloads_as_one_page_pdf_with_the_servers_qr(
    boss: TestClient, k134: PlantIds
) -> None:
    card = new_card(boss, k134, 1)

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    assert (
        response.headers["content-disposition"] == f'inline; filename="card-{card["serial"]}.pdf"'
    )
    assert len(pdf_pages(response.content)) == 1
    assert scanned_texts(response.content) == [build_payload(get_settings(), card["serial"])]


def test_every_print_is_counted_dated_and_audited_with_the_plant_on_the_card(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    card = new_card(boss, k134, 1)

    boss.get(f"{CARDS}/{card['id']}/card.pdf")
    boss.get(f"{CARDS}/{card['id']}/card.pdf")

    row = stored(db_session, card)
    assert row.print_count == 2
    assert row.last_printed_at is not None
    assert str(row.printed_plant_id) == k134.id
    entries = list(db_session.scalars(select(AuditLog).where(AuditLog.action == "qr_card.print")))
    assert len(entries) == 2
    assert entries[0].request_id != entries[1].request_id
    assert entries[1].after is not None
    assert entries[1].after["layout"] == "single_cards"
    assert entries[1].after["print_count"] == 2


def test_the_printed_plant_follows_a_transfer_only_when_the_card_is_printed_again(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    other = create_plant(boss, db_session, "TP1")
    card = new_card(boss, k134, 1)
    boss.get(f"{CARDS}/{card['id']}/card.pdf")
    employee = db_session.scalars(select(Employee)).one()
    employee.plant_id = uuid.UUID(other.id)  # the employee moved to TP1
    db_session.commit()

    before = boss.get(CARDS, params={"reprint_needed": "true"}).json()["items"]
    boss.get(f"{CARDS}/{card['id']}/card.pdf")
    after = boss.get(CARDS, params={"reprint_needed": "true"}).json()["items"]

    assert [item["employee"]["code"] for item in before] == ["T-1"]
    assert before[0]["card"]["printed_plant"]["code"] == "K134"
    assert after == []
    assert str(stored(db_session, card).printed_plant_id) == other.id


def test_the_plant_on_the_printed_card_is_the_employees_current_plant(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    card = new_card(boss, k134, 1)

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    text = pdf_pages(response.content)[0].get_textpage().get_text_range()
    assert "K134" in text
    assert "Plant K134" in text  # the plant's name from create_plant()
    assert "Worker Number 1" in text


def test_the_pdf_never_shows_the_end_date(boss: TestClient, k134: PlantIds) -> None:
    card = new_card(boss, k134, 1)
    ends = card["valid_until"]  # e.g. 2027-04-19
    end_as_printed = f"{ends[8:10]}/{ends[5:7]}/{ends[0:4]}"

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    text = pdf_pages(response.content)[0].get_textpage().get_text_range()
    assert end_as_printed not in text
    assert f"Issued {today_ist():%d/%m/%Y}" in text


# --- Many cards -------------------------------------------------------------------------------


def test_twelve_cards_print_on_two_a4_pages_and_each_is_counted_once(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    cards = [new_card(boss, k134, number) for number in range(1, 13)]

    response = boss.post(
        f"{CARDS}/print",
        json={"card_ids": [card["id"] for card in cards], "layout": "a4_sheet"},
    )

    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        f'inline; filename="cards-{today_ist().isoformat()}-12.pdf"'
    )
    assert len(pdf_pages(response.content)) == 2
    assert sorted(scanned_texts(response.content)) == sorted(
        build_payload(get_settings(), card["serial"]) for card in cards
    )
    assert {stored(db_session, card).print_count for card in cards} == {1}
    entries = list(db_session.scalars(select(AuditLog).where(AuditLog.action == "qr_card.print")))
    assert len(entries) == 12
    assert len({entry.request_id for entry in entries}) == 1  # one request, one shared id


def test_cards_are_ordered_by_plant_then_code_whatever_the_selection_order(
    boss: TestClient, k134: PlantIds
) -> None:
    cards = [new_card(boss, k134, number) for number in (3, 1, 2)]

    response = boss.post(
        f"{CARDS}/print", json={"card_ids": [card["id"] for card in cards], "layout": "a4_sheet"}
    )

    text = pdf_pages(response.content)[0].get_textpage().get_text_range()
    assert text.index("T-1") < text.index("T-2") < text.index("T-3")


def test_single_cards_layout_makes_one_page_per_card(boss: TestClient, k134: PlantIds) -> None:
    cards = [new_card(boss, k134, number) for number in range(1, 4)]

    response = boss.post(
        f"{CARDS}/print",
        json={"card_ids": [card["id"] for card in cards], "layout": "single_cards"},
    )

    assert len(pdf_pages(response.content)) == 3


def test_the_same_card_chosen_twice_is_printed_and_counted_once(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    card = new_card(boss, k134, 1)

    response = boss.post(f"{CARDS}/print", json={"card_ids": [card["id"], card["id"]]})

    assert len(scanned_texts(response.content)) == 1
    assert stored(db_session, card).print_count == 1


def test_a_test_card_prints_without_a_plant(boss: TestClient, db_session: Session) -> None:
    card = boss.post("/api/v1/qr-test-cards", json={"label": "Gate test K134"}).json()

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    text = pdf_pages(response.content)[0].get_textpage().get_text_range()
    assert "TEST – NOT AN ID CARD" in text
    assert scanned_texts(response.content) == [build_payload(get_settings(), card["serial"])]
    row = stored(db_session, card)
    assert row.print_count == 1
    assert row.printed_plant_id is None


# --- Refusals ---------------------------------------------------------------------------------


def test_a_revoked_card_cannot_be_printed_and_nothing_is_counted(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    good = new_card(boss, k134, 1)
    bad = new_card(boss, k134, 2)
    boss.post(f"{CARDS}/{bad['id']}/revoke", json={"kind": "lost", "reason": "Lost it"})

    response = boss.post(f"{CARDS}/print", json={"card_ids": [good["id"], bad["id"]]})

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "QR_CARD_REVOKED"
    assert error["details"] == {"serials": [bad["serial"]]}
    assert stored(db_session, good).print_count == 0  # all or nothing
    assert boss.get(f"{CARDS}/{bad['id']}/card.pdf").json()["error"]["code"] == "QR_CARD_REVOKED"


def test_more_than_200_cards_are_refused(boss: TestClient) -> None:
    response = boss.post(
        f"{CARDS}/print", json={"card_ids": [str(uuid.uuid4()) for _ in range(201)]}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PRINT_TOO_LARGE"


def test_an_empty_list_is_refused(boss: TestClient) -> None:
    assert boss.post(f"{CARDS}/print", json={"card_ids": []}).status_code == 422


def test_an_unknown_card_is_not_found(boss: TestClient, k134: PlantIds) -> None:
    card = new_card(boss, k134, 1)

    unknown = boss.get(f"{CARDS}/{uuid.uuid4()}/card.pdf")
    mixed = boss.post(f"{CARDS}/print", json={"card_ids": [card["id"], str(uuid.uuid4())]})

    assert unknown.json()["error"]["code"] == "QR_CARD_NOT_FOUND"
    assert mixed.status_code == 404


def test_nothing_is_printed_or_counted_without_a_signing_key(
    boss: TestClient, k134: PlantIds, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    card = new_card(boss, k134, 1)
    monkeypatch.delenv("QR_SIGNING_KEY")
    get_settings.cache_clear()

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "QR_SIGNING_NOT_CONFIGURED"
    assert stored(db_session, card).print_count == 0


# --- Roles ------------------------------------------------------------------------------------


def test_only_the_super_admin_may_print(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds
) -> None:
    card = new_card(boss, k134, 1)
    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp.head")
    plant_head = client_for(db_app, db_session, Role.PLANT_HEAD, "k134.head")
    user = db_session.scalars(select(User).where(User.username == "k134.head")).one()
    set_user_plant(db_session, user, uuid.UUID(k134.id))
    db_session.commit()

    for client in (corporate, plant_head):
        for response in (
            client.get(f"{CARDS}/{card['id']}/card.pdf"),
            client.post(f"{CARDS}/print", json={"card_ids": [card["id"]]}),
        ):
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "FORBIDDEN"
    assert stored(db_session, card).print_count == 0


def test_printing_needs_a_login(db_client: TestClient, boss: TestClient, k134: PlantIds) -> None:
    card = new_card(boss, k134, 1)
    logged_out = TestClient(db_client.app, headers=dict(db_client.headers))

    response = logged_out.get(f"{CARDS}/{card['id']}/card.pdf")

    assert response.status_code == 401


def test_a_card_of_an_employee_who_left_cannot_be_printed(
    boss: TestClient, k134: PlantIds, db_session: Session
) -> None:
    # Normally marking someone as left revokes the card. This is the repair case: the card is
    # still working but the employee is already marked as left in the database.
    card = new_card(boss, k134, 1)
    employee = db_session.scalars(select(Employee)).one()
    employee.status = "left"
    db_session.commit()

    response = boss.get(f"{CARDS}/{card['id']}/card.pdf")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMPLOYEE_LEFT"
    assert response.json()["error"]["details"] == {"serials": [card["serial"]]}
    assert stored(db_session, card).print_count == 0
