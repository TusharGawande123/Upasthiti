"""Holiday calendar endpoints (M5 spec §5.3): everyone in scope reads, the Super Admin writes."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.time import today_ist
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.holidays import service
from app.modules.holidays.schemas import (
    CreateHolidayRequest,
    HolidayCreated,
    HolidayResponse,
    ReasonBody,
)

router = APIRouter(tags=["holidays"])
reader = require(Capability.VIEW_ATTENDANCE)
writer = require(Capability.MANAGE_HOLIDAYS)


@router.get("/holidays", response_model=list[HolidayResponse])
def list_holidays(
    year: int | None = Query(default=None, ge=2020, le=2100),
    plant_id: uuid.UUID | None = None,
    state: Literal["active", "cancelled"] | None = None,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> list[HolidayResponse]:
    holidays = service.list_holidays(
        session,
        current_user,
        year=year or today_ist().year,
        plant_id=plant_id,
        state=state,
    )
    return service.present(session, holidays)


@router.post("/holidays", response_model=HolidayCreated, status_code=201)
def create_holiday(
    body: CreateHolidayRequest,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> HolidayCreated:
    holiday = service.create_holiday(session, current_user, body)
    return HolidayCreated(holiday=service.present(session, [holiday])[0])


@router.post("/holidays/{holiday_id}/cancel", response_model=HolidayCreated)
def cancel_holiday(
    holiday_id: uuid.UUID,
    body: ReasonBody,
    current_user: CurrentUser = Depends(writer),
    session: Session = Depends(get_session),
) -> HolidayCreated:
    holiday = service.cancel_holiday(session, current_user, holiday_id, body.reason)
    return HolidayCreated(holiday=service.present(session, [holiday])[0])
