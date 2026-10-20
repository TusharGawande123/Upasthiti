"""Builds card answers with names, plants and states in a few queries per page."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee
from app.modules.kiosks.schemas import PlantSummary
from app.modules.org.models import EmployeeCategory, Plant
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.schemas import CardListItem, CardResponse, EmployeeBrief, NamedItem
from app.modules.qr_cards.states import card_state
from app.modules.settings.service import get_int_setting
from app.modules.users.models import User


def card_responses(session: Session, cards: list[QrCredential]) -> list[CardResponse]:
    """One answer per card, in the same order."""
    if not cards:
        return []
    today = today_ist()
    expiring_days = get_int_setting(session, "qr_card_expiring_soon_days")

    user_ids = {card.issued_by for card in cards} | {
        card.revoked_by for card in cards if card.revoked_by is not None
    }
    user_names = _lookup(session, User.id, User.name, user_ids)

    employee_ids = {card.employee_id for card in cards if card.employee_id is not None}
    employee_plants = _lookup(session, Employee.id, Employee.plant_id, employee_ids)

    plant_ids = {card.printed_plant_id for card in cards if card.printed_plant_id is not None}
    plants = {
        plant.id: PlantSummary(id=plant.id, name=plant.name, code=plant.code)
        for plant in session.scalars(select(Plant).where(Plant.id.in_(plant_ids)))
    }

    return [
        CardResponse(
            id=card.id,
            kind=card.kind,
            serial=card.card_serial,
            label=card.label,
            state=card_state(card, today, expiring_days),
            valid_from=card.valid_from,
            valid_until=card.valid_until,
            issued_at=card.issued_at,
            issued_by=user_names.get(card.issued_by, ""),
            note=card.note,
            print_count=card.print_count,
            last_printed_at=card.last_printed_at,
            printed_plant=plants.get(card.printed_plant_id) if card.printed_plant_id else None,
            reprint_needed=_reprint_needed(card, employee_plants),
            revoked_at=card.revoked_at,
            revoked_by=user_names.get(card.revoked_by) if card.revoked_by else None,
            revoke_kind=card.revoke_kind,
            revoke_reason=card.revoke_reason,
            last_used_at=card.last_used_at,
        )
        for card in cards
    ]


def card_response(session: Session, card: QrCredential) -> CardResponse:
    return card_responses(session, [card])[0]


def list_items(
    session: Session, rows: list[tuple[Employee, QrCredential | None]]
) -> list[CardListItem]:
    cards = [card for _, card in rows if card is not None]
    by_card_id = {response.id: response for response in card_responses(session, cards)}
    briefs = employee_briefs(session, [employee for employee, _ in rows])
    return [
        CardListItem(
            employee=briefs[employee.id],
            card=by_card_id[card.id] if card is not None else None,
        )
        for employee, card in rows
    ]


def employee_briefs(session: Session, employees: list[Employee]) -> dict[uuid.UUID, EmployeeBrief]:
    plants = {
        plant.id: PlantSummary(id=plant.id, name=plant.name, code=plant.code)
        for plant in session.scalars(
            select(Plant).where(Plant.id.in_({employee.plant_id for employee in employees}))
        )
    }
    categories = _lookup(
        session, EmployeeCategory.id, EmployeeCategory.name, {e.category_id for e in employees}
    )
    contractors = _lookup(
        session,
        Contractor.id,
        Contractor.name,
        {e.contractor_id for e in employees if e.contractor_id is not None},
    )
    return {
        employee.id: EmployeeBrief(
            id=employee.id,
            code=employee.employee_code,
            name=employee.full_name,
            type=employee.type,
            plant=plants[employee.plant_id],
            contractor=(
                NamedItem(id=employee.contractor_id, name=contractors[employee.contractor_id])
                if employee.contractor_id is not None
                else None
            ),
            category=NamedItem(id=employee.category_id, name=categories[employee.category_id]),
            punch_method=employee.punch_method,
        )
        for employee in employees
    }


def _reprint_needed(card: QrCredential, employee_plants: dict[uuid.UUID, uuid.UUID]) -> bool:
    if card.kind != CardKind.EMPLOYEE.value or card.revoked_at is not None:
        return False
    if card.printed_plant_id is None or card.employee_id is None:
        return False
    return employee_plants.get(card.employee_id) != card.printed_plant_id


def _lookup(session: Session, key_column, value_column, keys: set) -> dict:  # noqa: ANN001
    if not keys:
        return {}
    return dict(session.execute(select(key_column, value_column).where(key_column.in_(keys))).all())
