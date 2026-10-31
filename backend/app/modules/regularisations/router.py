"""Attendance correction endpoints (M5 spec §5.2). Everyone in scope reads; the heads ask, the
Super Admin corrects directly, approves, rejects and reverses."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.regularisations import service
from app.modules.regularisations.schemas import (
    CorrectionCreated,
    CorrectionResponse,
    CreateCorrectionRequest,
    NoteBody,
    PreviewResponse,
    PunchApprovalItem,
    ReasonBody,
    SummaryResponse,
)

router = APIRouter(tags=["corrections"])
reader = require(Capability.VIEW_ATTENDANCE)
decider = require(Capability.DECIDE_CORRECTIONS)


def _one(session: Session, row) -> CorrectionCreated:  # noqa: ANN001
    return CorrectionCreated(correction=service.present(session, [row])[0])


@router.get("/regularisations", response_model=Page[CorrectionResponse])
def list_corrections(
    state: Literal["pending", "approved", "rejected", "withdrawn", "reversed"] | None = None,
    mine: bool = False,
    plant_id: uuid.UUID | None = None,
    employee_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[CorrectionResponse]:
    rows, total = service.list_corrections(
        session,
        current_user,
        params,
        state=state,
        mine=mine,
        plant_id=plant_id,
        employee_id=employee_id,
        date_from=date_from,
        date_to=date_to,
    )
    return Page(
        items=service.present(session, rows),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/punch-approvals", response_model=Page[PunchApprovalItem])
def punch_approvals(
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[PunchApprovalItem]:
    items, total = service.list_punch_approvals(
        session, current_user, params, date_from=date_from, date_to=date_to, plant_id=plant_id
    )
    return Page(items=items, page=params.page, page_size=params.page_size, total=total)


@router.get("/regularisations/summary", response_model=SummaryResponse)
def correction_summary(
    current_user: CurrentUser = Depends(reader), session: Session = Depends(get_session)
) -> SummaryResponse:
    return service.summary(session, current_user)


@router.post("/regularisations/preview", response_model=PreviewResponse)
def preview_correction(
    body: CreateCorrectionRequest,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> PreviewResponse:
    return service.preview(session, current_user, body)


@router.post("/regularisations", response_model=CorrectionCreated, status_code=201)
def create_correction(
    body: CreateCorrectionRequest,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> CorrectionCreated:
    return _one(session, service.create_correction(session, current_user, body))


@router.post("/regularisations/{correction_id}/approve", response_model=CorrectionCreated)
def approve_correction(
    correction_id: uuid.UUID,
    body: NoteBody | None = None,
    current_user: CurrentUser = Depends(decider),
    session: Session = Depends(get_session),
) -> CorrectionCreated:
    note = body.note if body else None
    return _one(session, service.approve(session, current_user, correction_id, note))


@router.post("/regularisations/{correction_id}/reject", response_model=CorrectionCreated)
def reject_correction(
    correction_id: uuid.UUID,
    body: ReasonBody,
    current_user: CurrentUser = Depends(decider),
    session: Session = Depends(get_session),
) -> CorrectionCreated:
    return _one(session, service.reject(session, current_user, correction_id, body.reason))


@router.post("/regularisations/{correction_id}/withdraw", response_model=CorrectionCreated)
def withdraw_correction(
    correction_id: uuid.UUID,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> CorrectionCreated:
    return _one(session, service.withdraw(session, current_user, correction_id))


@router.post(
    "/regularisations/{correction_id}/reverse", response_model=CorrectionCreated, status_code=201
)
def reverse_correction(
    correction_id: uuid.UUID,
    body: ReasonBody,
    current_user: CurrentUser = Depends(decider),
    session: Session = Depends(get_session),
) -> CorrectionCreated:
    return _one(session, service.reverse(session, current_user, correction_id, body.reason))
