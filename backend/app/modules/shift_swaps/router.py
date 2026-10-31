"""Shift swap endpoints (M5 spec §5.3, F-58). Everyone in scope reads; the Super Admin writes."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.shift_swaps import service
from app.modules.shift_swaps.schemas import (
    CancelSwapRequest,
    CreateSwapRequest,
    SwapCreated,
    SwapResponse,
)

router = APIRouter(tags=["shift swaps"])
reader = require(Capability.VIEW_ATTENDANCE)
writer = require(Capability.MANAGE_SHIFT_SWAPS)


@router.get("/employees/{employee_id}/shift-swaps", response_model=list[SwapResponse])
def list_swaps(
    employee_id: uuid.UUID,
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> list[SwapResponse]:
    swaps = service.swaps_of(
        session, current_user, employee_id, date_from=date_from, date_to=date_to
    )
    return service.present(session, swaps)


@router.post("/employees/{employee_id}/shift-swaps", response_model=SwapCreated, status_code=201)
def create_swap(
    employee_id: uuid.UUID,
    body: CreateSwapRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> SwapCreated:
    swap = service.create_swap(
        session,
        current_user,
        employee_id,
        swap_date=body.date,
        shift_id=body.shift_id,
        reason=body.reason,
    )
    return SwapCreated(swap=service.present(session, [swap])[0])


@router.post("/shift-swaps/{swap_id}/cancel", response_model=SwapCreated)
def cancel_swap(
    swap_id: uuid.UUID,
    body: CancelSwapRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> SwapCreated:
    swap = service.cancel_swap(session, current_user, swap_id, body.reason)
    return SwapCreated(swap=service.present(session, [swap])[0])
