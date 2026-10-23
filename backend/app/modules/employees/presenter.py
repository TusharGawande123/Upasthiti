"""Builds employee answers with readable names (plant code, category, shift…) in a few
queries per page instead of one query per employee."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.approvals.models import ChangeRequest, RequestStatus
from app.modules.contractors.models import Contractor
from app.modules.employees.models import Employee, EmployeePlantHistory, ShiftAssignment
from app.modules.employees.schemas import (
    EmployeeDetailResponse,
    EmployeeResponse,
    PlantHistoryItem,
    ShiftHistoryItem,
)
from app.modules.face.engine_provider import running_model_id
from app.modules.face.state import list_face_states
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift


def _names(session: Session, model, ids: set[uuid.UUID], column) -> dict[uuid.UUID, str]:  # noqa: ANN001
    if not ids:
        return {}
    return {
        row_id: name
        for row_id, name in session.execute(select(model.id, column).where(model.id.in_(ids)))
    }


def employee_responses(session: Session, employees: list[Employee]) -> list[EmployeeResponse]:
    employee_ids = [employee.id for employee in employees]
    open_shifts = {
        assignment.employee_id: assignment.shift_id
        for assignment in session.scalars(
            select(ShiftAssignment).where(
                ShiftAssignment.employee_id.in_(employee_ids), ShiftAssignment.to_date.is_(None)
            )
        )
    }
    pending = set(
        session.scalars(
            select(ChangeRequest.employee_id).where(
                ChangeRequest.employee_id.in_(employee_ids),
                ChangeRequest.status == RequestStatus.PENDING.value,
            )
        )
    )
    plant_codes = _names(session, Plant, {e.plant_id for e in employees}, Plant.code)
    categories = _names(
        session, EmployeeCategory, {e.category_id for e in employees}, EmployeeCategory.name
    )
    departments = _names(
        session,
        Department,
        {e.department_id for e in employees if e.department_id},
        Department.name,
    )
    shifts = _names(session, Shift, set(open_shifts.values()), Shift.name)
    contractors = _names(
        session,
        Contractor,
        {e.contractor_id for e in employees if e.contractor_id},
        Contractor.name,
    )

    states = list_face_states(session, employees, running_model_id())

    return [
        EmployeeResponse(
            id=employee.id,
            employee_code=employee.employee_code,
            full_name=employee.full_name,
            type=employee.type,
            plant_id=employee.plant_id,
            plant_code=plant_codes.get(employee.plant_id, ""),
            category_id=employee.category_id,
            category_name=categories.get(employee.category_id, ""),
            department_id=employee.department_id,
            department_name=departments.get(employee.department_id)
            if employee.department_id
            else None,
            shift_id=open_shifts.get(employee.id),
            shift_name=shifts.get(open_shifts[employee.id]) if employee.id in open_shifts else None,
            contractor_id=employee.contractor_id,
            contractor_name=contractors.get(employee.contractor_id)
            if employee.contractor_id
            else None,
            punch_method=employee.punch_method,
            hourly_rate=employee.hourly_rate,
            ot_rate_per_hour=employee.ot_rate_per_hour,
            status=employee.status,
            joined_on=employee.joined_on,
            left_on=employee.left_on,
            left_reason=employee.left_reason,
            has_pending_change=employee.id in pending,
            face_state=states[employee.id],
        )
        for employee in employees
    ]


def employee_detail(
    session: Session,
    employee: Employee,
    shift_rows: list[ShiftAssignment],
    plant_rows: list[EmployeePlantHistory],
) -> EmployeeDetailResponse:
    shift_names = _names(session, Shift, {row.shift_id for row in shift_rows}, Shift.name)
    plant_codes = _names(session, Plant, {row.plant_id for row in plant_rows}, Plant.code)
    return EmployeeDetailResponse(
        employee=employee_responses(session, [employee])[0],
        shift_history=[
            ShiftHistoryItem(
                shift_id=row.shift_id,
                shift_name=shift_names.get(row.shift_id, ""),
                from_date=row.from_date,
                to_date=row.to_date,
            )
            for row in shift_rows
        ],
        plant_history=[
            PlantHistoryItem(
                plant_id=row.plant_id,
                plant_code=plant_codes.get(row.plant_id, ""),
                from_date=row.from_date,
                to_date=row.to_date,
                reason=row.reason,
            )
            for row in plant_rows
        ],
    )
