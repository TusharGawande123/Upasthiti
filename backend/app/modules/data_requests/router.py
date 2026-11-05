"""Data-request register endpoints (M6 spec section 5). Super Admin only."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.data_requests import service
from app.modules.data_requests.schemas import (
    AddEventRequest,
    CreateDataRequest,
    DataRequestDetailResponse,
    DataRequestResponse,
    EventResponse,
    RequestKind,
    RequestStatus,
)

router = APIRouter(prefix="/data-requests", tags=["data-requests"])
super_admin = require(Capability.MANAGE_DATA_REQUESTS)


@router.get("", response_model=Page[DataRequestResponse])
def list_data_requests(
    status: RequestStatus | None = None,
    kind: RequestKind | None = None,
    overdue: bool | None = Query(default=None, description="Past the due day and not closed"),
    due_soon: bool | None = Query(
        default=None,
        description=(
            f"Not closed and due in {service.DUE_SOON_DAYS} days or less (or overdue): the banner"
        ),
    ),
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> Page[DataRequestResponse]:
    items, total = service.list_requests(
        session, params, status=status, kind=kind, overdue=overdue, due_soon=due_soon
    )
    return Page(items=items, page=params.page, page_size=params.page_size, total=total)


@router.post("", response_model=DataRequestDetailResponse, status_code=201)
def create_data_request(
    body: CreateDataRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> DataRequestDetailResponse:
    return service.create_request(session, current_user, body)


@router.get("/{request_id}", response_model=DataRequestDetailResponse)
def get_data_request(
    request_id: uuid.UUID,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> DataRequestDetailResponse:
    return service.get_request_detail(session, request_id)


@router.post("/{request_id}/events", response_model=EventResponse, status_code=201)
def add_data_request_event(
    request_id: uuid.UUID,
    body: AddEventRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> EventResponse:
    return service.add_event(session, current_user, request_id, body)
