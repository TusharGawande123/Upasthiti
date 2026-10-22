"""Reading cards: the list of employees with their latest card, one employee's card history,
and the "ending soon" count. Every list honours the user's plant scope (the employee's plant)."""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.states import CardState


@dataclass(frozen=True)
class CardFilters:
    plant_id: uuid.UUID | None = None
    type: str | None = None
    punch_method: str | None = None
    contractor_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    state: CardState | None = None
    printed: bool | None = None
    reprint_needed: bool | None = None
    search: str | None = None


def get_card(session: Session, card_id: uuid.UUID) -> QrCredential:
    card = session.get(QrCredential, card_id)
    if card is None:
        raise ApiError("QR_CARD_NOT_FOUND", "Card not found.", 404)
    return card


def active_card_of(session: Session, employee_id: uuid.UUID) -> QrCredential | None:
    """The employee's card that is not revoked (the database allows at most one)."""
    return session.scalar(
        select(QrCredential).where(
            QrCredential.employee_id == employee_id,
            QrCredential.kind == CardKind.EMPLOYEE.value,
            QrCredential.revoked_at.is_(None),
        )
    )


def cards_of_employee(session: Session, employee_id: uuid.UUID) -> list[QrCredential]:
    """Every card the employee ever had, newest first."""
    return list(
        session.scalars(
            select(QrCredential)
            .where(QrCredential.employee_id == employee_id)
            .order_by(QrCredential.issued_at.desc(), QrCredential.id.desc())
        )
    )


def list_test_cards(session: Session) -> list[QrCredential]:
    return list(
        session.scalars(
            select(QrCredential)
            .where(QrCredential.kind == CardKind.TEST.value)
            .order_by(QrCredential.issued_at.desc(), QrCredential.id.desc())
        )
    )


def list_employees_with_cards(
    session: Session,
    params: PageParams,
    filters: CardFilters,
    *,
    only_plant_ids: frozenset[uuid.UUID] | None,
    today: date,
    expiring_soon_days: int,
) -> tuple[list[tuple[Employee, QrCredential | None]], int]:
    """One page of active employees, each with the latest card they had (or None)."""
    latest_card_id = (
        select(QrCredential.id)
        .where(
            QrCredential.employee_id == Employee.id,
            QrCredential.kind == CardKind.EMPLOYEE.value,
        )
        .order_by(QrCredential.issued_at.desc(), QrCredential.id.desc())
        .limit(1)
        .correlate(Employee)
        .scalar_subquery()
    )
    card = aliased(QrCredential)
    statement = (
        select(Employee)
        .outerjoin(card, card.id == latest_card_id)
        .where(Employee.status == EmployeeStatus.ACTIVE.value)
        .order_by(Employee.employee_code)
    )
    if only_plant_ids is not None:
        statement = statement.where(Employee.plant_id.in_(only_plant_ids))
    statement = _apply_filters(statement, filters, card, today, expiring_soon_days)

    employees, total = fetch_page(session, statement, params)
    cards = _latest_cards(session, [employee.id for employee in employees])
    return [(employee, cards.get(employee.id)) for employee in employees], total


def count_expiring(session: Session, today: date, expiring_soon_days: int) -> int:
    """Working cards of active employees that end within `expiring_soon_days` (F-33)."""
    return (
        session.scalar(
            select(func.count())
            .select_from(QrCredential)
            .join(Employee, Employee.id == QrCredential.employee_id)
            .where(
                QrCredential.kind == CardKind.EMPLOYEE.value,
                Employee.status == EmployeeStatus.ACTIVE.value,
                *_state_conditions(QrCredential, CardState.EXPIRING, today, expiring_soon_days),
            )
        )
        or 0
    )


def _latest_cards(session: Session, employee_ids: list[uuid.UUID]) -> dict[uuid.UUID, QrCredential]:
    if not employee_ids:
        return {}
    rows = session.scalars(
        select(QrCredential)
        .where(
            QrCredential.employee_id.in_(employee_ids), QrCredential.kind == CardKind.EMPLOYEE.value
        )
        .order_by(QrCredential.issued_at, QrCredential.id)
    )
    # Oldest first, so the newest card of each employee wins.
    return {row.employee_id: row for row in rows if row.employee_id is not None}


def _apply_filters(
    statement: Select[Employee],
    filters: CardFilters,
    card: type[QrCredential],
    today: date,
    expiring_soon_days: int,
) -> Select[Employee]:
    for column, value in (
        (Employee.plant_id, filters.plant_id),
        (Employee.type, filters.type),
        (Employee.punch_method, filters.punch_method),
        (Employee.contractor_id, filters.contractor_id),
        (Employee.category_id, filters.category_id),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if filters.state is CardState.NONE:
        statement = statement.where(card.id.is_(None))
    elif filters.state is not None:
        statement = statement.where(
            *_state_conditions(card, filters.state, today, expiring_soon_days)
        )
    if filters.printed is not None:
        statement = statement.where(
            card.print_count > 0
            if filters.printed
            else or_(card.id.is_(None), card.print_count == 0)
        )
    if filters.reprint_needed:
        statement = statement.where(
            card.revoked_at.is_(None),
            card.printed_plant_id.is_not(None),
            card.printed_plant_id != Employee.plant_id,
        )
    if filters.search:
        cleaned = filters.search.strip()
        statement = statement.where(
            or_(
                Employee.employee_code.startswith(cleaned.upper()),
                func.lower(Employee.full_name).contains(cleaned.lower()),
                card.card_serial == cleaned.upper(),
            )
        )
    return statement


def _state_conditions(
    card: type[QrCredential], state: CardState, today: date, expiring_soon_days: int
) -> list:  # noqa: ANN401 (SQL conditions)
    """The same rules as `card_state()`, written as SQL so lists can filter on them."""
    soon = today + timedelta(days=expiring_soon_days)
    not_revoked = card.revoked_at.is_(None)
    match state:
        case CardState.REVOKED:
            return [card.revoked_at.is_not(None)]
        case CardState.NOT_YET_VALID:
            return [not_revoked, card.valid_from > today]
        case CardState.EXPIRED:
            return [not_revoked, card.valid_from <= today, card.valid_until < today]
        case CardState.EXPIRING:
            return [
                not_revoked,
                and_(card.valid_from <= today, card.valid_until >= today, card.valid_until <= soon),
            ]
        case CardState.ACTIVE:
            return [not_revoked, card.valid_from <= today, card.valid_until > soon]
        case _:
            return []
