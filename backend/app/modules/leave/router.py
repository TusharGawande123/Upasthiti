"""Leave endpoints (M5 spec §5.3). Everyone in scope reads; only the Super Admin writes."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.holidays.schemas import ReasonBody
from app.modules.leave import service
from app.modules.leave.schemas import CreateLeaveRequest, LeaveCreated, LeaveResponse

router = APIRouter(tags=["leave"])
reader = require(Capability.VIEW_ATTENDANCE)
writer = require(Capability.MANAGE_LEAVE)


@router.get("/leave", response_model=Page[LeaveResponse])
def list_leave(
    plant_id: uuid.UUID | None = None,
    employee_id: uuid.UUID | None = None,
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    is_paid: bool | None = None,
    state: Literal["active", "cancelled"] | None = None,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[LeaveResponse]:
    records, total = service.list_leave(
        session,
        current_user,
        params,
        plant_id=plant_id,
        employee_id=employee_id,
        month=date.fromisoformat(f"{month}-01") if month else None,
        is_paid=is_paid,
        state=state,
    )
    return Page(
        items=service.present(session, current_user, records),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.post("/leave", response_model=LeaveCreated, status_code=201)
def create_leave(
    body: CreateLeaveRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> LeaveCreated:
    leave = service.create_leave(session, current_user, body)
    return LeaveCreated(leave=service.present(session, current_user, [leave])[0])


@router.post("/leave/{leave_id}/cancel", response_model=LeaveCreated)
def cancel_leave(
    leave_id: uuid.UUID,
    body: ReasonBody,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> LeaveCreated:
    leave = service.cancel_leave(session, current_user, leave_id, body.reason)
    return LeaveCreated(leave=service.present(session, current_user, [leave])[0])
