"""Gate notice endpoints (spec M2 §5.4, F-25). The kiosk reads its notices through /kiosk/me."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.core.time import utc_now
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.notices import service
from app.modules.notices.schemas import (
    CreateNoticeRequest,
    NoticeResponse,
    NoticeState,
    UpdateNoticeRequest,
)

router = APIRouter(tags=["notices"])
reader = require(Capability.VIEW_NOTICES)
writer = require(Capability.MANAGE_NOTICES)


def _one(session: Session, current_user: CurrentUser, notice) -> NoticeResponse:  # noqa: ANN001
    return service.present(session, current_user, [notice], utc_now())[0]


@router.get("/notices", response_model=Page[NoticeResponse])
def list_notices(
    params: PageParams = Depends(page_params),
    plant_id: uuid.UUID | None = None,
    all_plants: bool = Query(default=False, description="Only the notices for every plant"),
    state: NoticeState | None = None,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[NoticeResponse]:
    items, total = service.list_notices(
        session,
        current_user,
        params,
        plant_id=plant_id,
        all_plants_only=all_plants,
        state=state,
    )
    return Page(items=items, page=params.page, page_size=params.page_size, total=total)


@router.post("/notices", response_model=NoticeResponse, status_code=201)
def create_notice(
    body: CreateNoticeRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> NoticeResponse:
    return _one(session, current_user, service.create_notice(session, current_user, body))


@router.patch("/notices/{notice_id}", response_model=NoticeResponse)
def update_notice(
    notice_id: uuid.UUID,
    body: UpdateNoticeRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> NoticeResponse:
    notice = service.get_notice(session, current_user, notice_id)
    return _one(session, current_user, service.update_notice(session, current_user, notice, body))


@router.post("/notices/{notice_id}/end", response_model=NoticeResponse)
def end_notice(
    notice_id: uuid.UUID,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> NoticeResponse:
    notice = service.get_notice(session, current_user, notice_id)
    return _one(session, current_user, service.end_notice(session, current_user, notice))
