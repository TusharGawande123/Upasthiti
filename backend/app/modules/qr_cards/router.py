"""QR card endpoints (spec §5.1): the cards list, an employee's cards, issue, revoke, change
the end date, bulk actions and test cards.

Reading is for all three roles (a Plant Head sees their own plant). Every change is for the
Super Admin only (decisions 0005 and 0009). PDF printing comes in the next step.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.pagination import Page, PageParams, page_params
from app.core.time import today_ist
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.employees.queries import get_employee
from app.modules.qr_cards import presenter, queries, service
from app.modules.qr_cards.models import CardKind, RevokeKind
from app.modules.qr_cards.schemas import (
    BulkCardsRequest,
    BulkCardsResponse,
    CardListItem,
    CardResponse,
    ChangeValidityRequest,
    CreateTestCardRequest,
    EmployeeCardsResponse,
    ExpiringCountResponse,
    IssueCardRequest,
    IssueCardResponse,
    RevokeCardRequest,
    RevokeTestCardRequest,
    SkippedItem,
)
from app.modules.qr_cards.states import CardState
from app.modules.settings.service import get_int_setting

router = APIRouter(tags=["qr-cards"])
viewer = require(Capability.VIEW_QR_CARDS)
manager = require(Capability.MANAGE_QR_CARDS)


@router.get("/qr-cards", response_model=Page[CardListItem])
def list_cards(
    plant_id: uuid.UUID | None = None,
    type: str | None = Query(default=None, pattern="^(permanent|temporary)$"),  # noqa: A002
    punch_method: str | None = Query(default=None, pattern="^(face|qr)$"),
    contractor_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    state: CardState | None = None,
    printed: bool | None = None,
    reprint_needed: bool | None = None,
    q: str | None = Query(default=None, max_length=60),
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> Page[CardListItem]:
    filters = queries.CardFilters(
        plant_id=plant_id,
        type=type,
        punch_method=punch_method,
        contractor_id=contractor_id,
        category_id=category_id,
        state=state,
        printed=printed,
        reprint_needed=reprint_needed,
        search=q,
    )
    rows, total = queries.list_employees_with_cards(
        session,
        params,
        filters,
        only_plant_ids=plant_filter(current_user, Capability.VIEW_QR_CARDS),
        today=today_ist(),
        expiring_soon_days=get_int_setting(session, "qr_card_expiring_soon_days"),
    )
    return Page(
        items=presenter.list_items(session, rows),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/qr-cards/expiring-count", response_model=ExpiringCountResponse)
def expiring_count(
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> ExpiringCountResponse:
    days = get_int_setting(session, "qr_card_expiring_soon_days")
    return ExpiringCountResponse(
        count=queries.count_expiring(session, today_ist(), days), days=days
    )


@router.get("/employees/{employee_id}/qr-cards", response_model=EmployeeCardsResponse)
def employee_cards(
    employee_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> EmployeeCardsResponse:
    employee = _employee_in_scope(session, current_user, employee_id)
    cards = queries.cards_of_employee(session, employee.id)
    return EmployeeCardsResponse(cards=presenter.card_responses(session, cards))


@router.post("/employees/{employee_id}/qr-cards", response_model=IssueCardResponse, status_code=201)
def issue_card(
    employee_id: uuid.UUID,
    body: IssueCardRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> IssueCardResponse:
    employee = get_employee(session, employee_id, only_plant_ids=None)
    result = service.issue_card(
        session,
        current_user.actor,
        employee,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        note=body.note,
    )
    session.commit()
    cards = [result.card] + ([result.replaced_card] if result.replaced_card else [])
    responses = presenter.card_responses(session, cards)
    return IssueCardResponse(
        card=responses[0], replaced_card=responses[1] if result.replaced_card else None
    )


@router.patch("/qr-cards/{card_id}", response_model=CardResponse)
def change_valid_until(
    card_id: uuid.UUID,
    body: ChangeValidityRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> CardResponse:
    card = queries.get_card(session, card_id)
    service.change_valid_until(session, current_user.actor, card, body.valid_until, body.reason)
    session.commit()
    return presenter.card_response(session, card)


@router.post("/qr-cards/{card_id}/revoke", response_model=CardResponse)
def revoke_card(
    card_id: uuid.UUID,
    body: RevokeCardRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> CardResponse:
    card = queries.get_card(session, card_id)
    service.revoke_card(session, current_user.actor, card, RevokeKind(body.kind), body.reason)
    session.commit()
    return presenter.card_response(session, card)


@router.post("/qr-cards/bulk", response_model=BulkCardsResponse)
def bulk_cards(
    body: BulkCardsRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> BulkCardsResponse:
    if body.action == "issue":
        result = service.bulk_issue(
            session,
            current_user.actor,
            body.employee_ids,
            valid_until=body.valid_until,
            reason=body.reason,
        )
    else:
        if body.kind is None:
            raise ApiError("VALIDATION_FAILED", "Choose why the cards are revoked.", 422)
        result = service.bulk_revoke(
            session,
            current_user.actor,
            body.card_ids,
            kind=RevokeKind(body.kind),
            reason=body.reason,
        )
    session.commit()
    return BulkCardsResponse(
        done=result.done,
        skipped=[
            SkippedItem(code=row.code, employee_code=row.employee_code, card_serial=row.card_serial)
            for row in result.skipped
        ],
    )


# --- Test cards (F-27) ------------------------------------------------------------------------


@router.get("/qr-test-cards", response_model=list[CardResponse])
def list_test_cards(
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> list[CardResponse]:
    return presenter.card_responses(session, queries.list_test_cards(session))


@router.post("/qr-test-cards", response_model=CardResponse, status_code=201)
def create_test_card(
    body: CreateTestCardRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> CardResponse:
    card = service.issue_test_card(session, current_user.actor, body.label.strip())
    session.commit()
    return presenter.card_response(session, card)


@router.post("/qr-test-cards/{card_id}/revoke", response_model=CardResponse)
def revoke_test_card(
    card_id: uuid.UUID,
    body: RevokeTestCardRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> CardResponse:
    card = queries.get_card(session, card_id)
    if card.kind != CardKind.TEST.value:
        raise ApiError("QR_CARD_NOT_FOUND", "Card not found.", 404)
    service.revoke_card(session, current_user.actor, card, RevokeKind.OTHER, body.reason)
    session.commit()
    return presenter.card_response(session, card)


def _employee_in_scope(
    session: Session, current_user: CurrentUser, employee_id: uuid.UUID
) -> Employee:
    return get_employee(
        session, employee_id, only_plant_ids=plant_filter(current_user, Capability.VIEW_QR_CARDS)
    )
