"""Attendance endpoints (M5 spec §5.1): the daily list, the register, an employee's month and
day, the undecided count and the Super Admin's recompute."""

import uuid
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.pagination import Page, PageParams, page_params
from app.modules.attendance import detail_service, read_service, service
from app.modules.attendance.schemas import (
    DailyItem,
    RecomputeRequest,
    RecomputeResponse,
    RegisterPlant,
    RegisterResponse,
    UndecidedResponse,
)
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.employees.models import Employee
from app.modules.org.models import Plant

router = APIRouter(tags=["attendance"], prefix="/attendance")
reader = require(Capability.VIEW_ATTENDANCE)
recomputer = require(Capability.RECOMPUTE_ATTENDANCE)

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
MAX_RECOMPUTE_DAYS = 62


@router.get("/daily", response_model=Page[DailyItem])
def daily(
    date: date,
    plant_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, max_length=12),
    type: Literal["permanent", "temporary"] | None = None,  # noqa: A002
    department_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    contractor_id: uuid.UUID | None = None,
    shift_id: uuid.UUID | None = None,
    has_exceptions: bool | None = None,
    corrected: bool | None = None,
    q: str | None = Query(default=None, max_length=100),
    include_demo: bool = False,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[DailyItem]:
    rows, total = read_service.daily(
        session,
        current_user,
        params,
        day=date,
        plant_id=plant_id,
        status=status,
        employee_type=type,
        department_id=department_id,
        category_id=category_id,
        contractor_id=contractor_id,
        shift_id=shift_id,
        has_exceptions=has_exceptions,
        corrected=corrected,
        q=q,
        include_demo=include_demo,
    )
    people = read_service.person_summaries(session, [employee.id for employee, _ in rows])
    return Page(
        items=[DailyItem(employee=people[employee.id], day=day_) for employee, day_ in rows],
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/register", response_model=RegisterResponse)
def register(
    month: str = Query(pattern=MONTH_PATTERN),
    plant_id: uuid.UUID = Query(),
    type: Literal["permanent", "temporary"] | None = None,  # noqa: A002
    department_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    include_demo: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> RegisterResponse:
    plant, days_in_month, items, total = read_service.register(
        session,
        current_user,
        PageParams(page=page, page_size=page_size),
        month=month,
        plant_id=plant_id,
        employee_type=type,
        department_id=department_id,
        q=q,
        include_demo=include_demo,
    )
    return RegisterResponse(
        month=month,
        plant=RegisterPlant(id=plant.id, code=plant.code, name=plant.name),
        days_in_month=days_in_month,
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/undecided", response_model=UndecidedResponse)
def undecided(
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None = None,
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> UndecidedResponse:
    return read_service.undecided(
        session,
        current_user,
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        include_demo=include_demo,
    )


@router.get("/employee/{employee_id}")
def employee_month(
    employee_id: uuid.UUID,
    month: str = Query(pattern=MONTH_PATTERN),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    employee = detail_service.employee_for_reading(session, current_user, employee_id)
    return detail_service.month_of_employee(session, current_user, employee, month)


@router.get("/employee/{employee_id}/day/{day}")
def employee_day(
    employee_id: uuid.UUID,
    day: date,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    employee = detail_service.employee_for_reading(session, current_user, employee_id)
    return detail_service.day_of_employee(session, current_user, employee, day)


@router.post("/recompute", response_model=RecomputeResponse, status_code=202)
def recompute(
    body: RecomputeRequest,
    current_user: CurrentUser = Depends(recomputer),
    session: Session = Depends(get_session),
) -> RecomputeResponse:
    """Mark days stale; the catch-up job (and every read) recomputes them. Super Admin only."""
    if body.date_to < body.date_from:
        raise ApiError("VALIDATION_FAILED", "The end is before the start.", 422)
    if (body.date_to - body.date_from).days + 1 > MAX_RECOMPUTE_DAYS:
        raise ApiError(
            "RECOMPUTE_RANGE_TOO_LONG",
            "Choose at most 62 days.",
            422,
            {"max_days": MAX_RECOMPUTE_DAYS},
        )
    marked = service.mark_days_stale_counted(
        session, _employees_to_recompute(session, body), body.date_from, body.date_to
    )
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance.recompute",
        entity_type="attendance",
        after={
            "plant_id": body.plant_id,
            "employee_id": body.employee_id,
            "date_from": body.date_from,
            "date_to": body.date_to,
            "days_marked": marked,
        },
    )
    session.commit()
    return RecomputeResponse(days_marked=marked)


def _employees_to_recompute(session: Session, body: RecomputeRequest) -> list[uuid.UUID]:
    statement = select(Employee.id)
    if body.employee_id:
        statement = statement.where(Employee.id == body.employee_id)
    elif body.plant_id:
        if session.get(Plant, body.plant_id) is None:
            raise ApiError("NOT_FOUND", "Not found.", 404)
        statement = statement.where(Employee.plant_id == body.plant_id)
    return list(session.scalars(statement))
