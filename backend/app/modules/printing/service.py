"""Printing cards (spec §4.9, §7 rule 3): checks that the cards may be printed, makes the PDF,
and records each print (count, date, the plant shown on the card) with an audit entry.

Super Admin only (decisions 0005 and 0009): a printed card is a working credential. Nothing is
counted or audited unless the whole PDF was made.
"""

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.time import IST, today_ist, utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.org.models import Plant
from app.modules.printing.cards_pdf import CardFace, a4_sheets_pdf, single_cards_pdf
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.payload import build_payload

MAX_PRINT_CARDS = 200
PrintLayout = Literal["a4_sheet", "single_cards"]


@dataclass(frozen=True)
class PrintedPdf:
    content: bytes
    filename: str


@dataclass(frozen=True)
class _Printable:
    card: QrCredential
    employee: Employee | None
    plant: Plant | None
    contractor: Contractor | None


def print_cards(
    session: Session, actor: Actor, card_ids: list[uuid.UUID], layout: PrintLayout
) -> PrintedPdf:
    """The PDF for the chosen cards, in a fixed order (plant, contractor, employee code)."""
    unique_ids = list(dict.fromkeys(card_ids))
    if len(unique_ids) > MAX_PRINT_CARDS:
        raise ApiError("PRINT_TOO_LARGE", f"Print at most {MAX_PRINT_CARDS} cards at a time.", 422)

    printables = sorted(_load(session, unique_ids), key=_sort_key)
    settings = get_settings()
    faces = [_face(settings, item) for item in printables]  # QR_SIGNING_NOT_CONFIGURED stops here
    content = a4_sheets_pdf(faces) if layout == "a4_sheet" else single_cards_pdf(faces)

    for item in printables:
        _record_print(session, actor, item, layout)

    if len(printables) == 1:
        filename = f"card-{printables[0].card.card_serial}.pdf"
    else:
        filename = f"cards-{today_ist().isoformat()}-{len(printables)}.pdf"
    return PrintedPdf(content=content, filename=filename)


# --- Loading and checking ---------------------------------------------------------------------


def _load(session: Session, card_ids: list[uuid.UUID]) -> list[_Printable]:
    cards = {
        card.id: card
        for card in session.scalars(select(QrCredential).where(QrCredential.id.in_(card_ids)))
    }
    if len(cards) != len(card_ids):
        raise ApiError("QR_CARD_NOT_FOUND", "Card not found.", 404)

    revoked = [card.card_serial for card in cards.values() if card.revoked_at is not None]
    if revoked:
        raise ApiError(
            "QR_CARD_REVOKED",
            "A revoked card cannot be printed. Issue a new card.",
            409,
            details={"serials": sorted(revoked)},
        )

    employee_ids = {card.employee_id for card in cards.values() if card.employee_id is not None}
    employees = {
        employee.id: employee
        for employee in session.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    left = [
        card.card_serial
        for card in cards.values()
        if card.employee_id is not None
        and employees[card.employee_id].status != EmployeeStatus.ACTIVE.value
    ]
    if left:
        raise ApiError(
            "EMPLOYEE_LEFT",
            "This employee has left, so the card cannot be printed.",
            409,
            details={"serials": sorted(left)},
        )

    plants = {
        plant.id: plant
        for plant in session.scalars(
            select(Plant).where(Plant.id.in_({e.plant_id for e in employees.values()}))
        )
    }
    contractor_ids = {e.contractor_id for e in employees.values() if e.contractor_id is not None}
    contractors = {
        contractor.id: contractor
        for contractor in session.scalars(
            select(Contractor).where(Contractor.id.in_(contractor_ids))
        )
    }
    printables = []
    for card_id in card_ids:
        card = cards[card_id]
        employee = employees.get(card.employee_id) if card.employee_id else None
        printables.append(
            _Printable(
                card=card,
                employee=employee,
                plant=plants.get(employee.plant_id) if employee else None,
                contractor=(
                    contractors.get(employee.contractor_id)
                    if employee and employee.contractor_id
                    else None
                ),
            )
        )
    return printables


def _sort_key(item: _Printable) -> tuple[int, str, str, str]:
    """Employee cards first, by plant, contractor and code; test cards at the end."""
    if item.employee is None or item.plant is None:
        return (1, "", "", item.card.card_serial)
    contractor_name = item.contractor.name.lower() if item.contractor else ""
    return (0, item.plant.code, contractor_name, item.employee.employee_code)


def _face(settings, item: _Printable) -> CardFace:  # noqa: ANN001 (Settings)
    card = item.card
    issued_on = card.issued_at.astimezone(IST).date()
    qr_text = build_payload(settings, card.card_serial)
    if card.kind == CardKind.TEST.value:
        return CardFace(
            serial=card.card_serial,
            qr_text=qr_text,
            issued_on=issued_on,
            is_test=True,
            label=card.label or "",
        )
    if item.employee is None or item.plant is None:
        # The database guarantees an employee card has an employee, so this cannot happen.
        raise ValueError(f"Card {card.card_serial} has no employee")
    return CardFace(
        serial=card.card_serial,
        qr_text=qr_text,
        issued_on=issued_on,
        employee_name=item.employee.full_name,
        employee_code=item.employee.employee_code,
        contractor_name=item.contractor.name if item.contractor else None,
        plant_name=item.plant.name,
        plant_code=item.plant.code,
    )


# --- Recording the print ----------------------------------------------------------------------


def _record_print(session: Session, actor: Actor, item: _Printable, layout: str) -> None:
    card = item.card
    before = {"print_count": card.print_count}
    card.print_count += 1
    card.last_printed_at = utc_now()
    # The plant shown on the card. After a later transfer it no longer matches, and the
    # list says "Reprint needed".
    card.printed_plant_id = item.plant.id if item.plant else None
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="qr_card.print",
        entity_type="qr_card",
        entity_id=card.id,
        before=before,
        after={
            "card_serial": card.card_serial,
            "print_count": card.print_count,
            "layout": layout,
            "printed_plant_id": card.printed_plant_id,
        },
        plant_id=item.plant.id if item.plant else None,
    )
