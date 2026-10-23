"""Employee endpoints (spec §5.3).

One rule decides every write (decision 0005): the Super Admin's change is applied at once;
a Corporate Head's change becomes a change request (answer 202) that waits for a Super
Admin's approval; a Plant Head may only read their own plant. The role decides, never the
browser.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.pagination import Page, PageParams, page_params
from app.modules.approvals import service as approvals
from app.modules.approvals.models import RequestKind
from app.modules.approvals.payloads import to_json, values_to_json
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees import import_excel, operations, queries
from app.modules.employees.models import Employee, PunchMethod
from app.modules.employees.presenter import employee_detail, employee_responses
from app.modules.employees.rules import EmployeeValues, default_punch_method
from app.modules.employees.schemas import (
    BulkRequest,
    BulkResponse,
    ChangeRequestCreated,
    CreateEmployeeRequest,
    EmployeeDetailResponse,
    EmployeeResponse,
    ImportResponse,
    ImportRowError,
    MarkLeftRequest,
    ReactivateRequest,
    TimelineEventResponse,
    TransferRequest,
    UpdateEmployeeRequest,
)

router = APIRouter(prefix="/employees", tags=["employees"])
viewer = require(Capability.VIEW_EMPLOYEES)
changer = require(Capability.CHANGE_EMPLOYEES)
leaver = require(Capability.MARK_EMPLOYEE_LEFT)


def _scope(current_user: CurrentUser) -> frozenset[uuid.UUID] | None:
    return plant_filter(current_user, Capability.VIEW_EMPLOYEES)


def _needs_approval(current_user: CurrentUser) -> bool:
    return current_user.access(Capability.CHANGE_EMPLOYEES) is Access.VIA_APPROVAL


def _accepted(request_id: uuid.UUID, summary: str) -> JSONResponse:
    body = ChangeRequestCreated(change_request_id=request_id, status="pending", summary=summary)
    return JSONResponse(status_code=202, content=body.model_dump(mode="json"))


def _one(session: Session, employee: Employee) -> EmployeeResponse:
    return employee_responses(session, [employee])[0]


# --- Reading ---------------------------------------------------------------------------------


@router.get("", response_model=Page[EmployeeResponse])
def list_employees(
    plant_id: uuid.UUID | None = None,
    type: str | None = Query(default=None, max_length=10),
    status: str | None = Query(default=None, max_length=6),
    category_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
    shift_id: uuid.UUID | None = None,
    contractor_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    face_state: str | None = Query(
        default=None, pattern="^(enrolled|not_enrolled|reenrol_suggested|old_model)$"
    ),
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> Page[EmployeeResponse]:
    filters = queries.EmployeeFilters(
        plant_id=plant_id,
        type=type,
        status=status,
        category_id=category_id,
        department_id=department_id,
        shift_id=shift_id,
        contractor_id=contractor_id,
        search=q,
        face_state=face_state,
    )
    employees, total = queries.list_employees(
        session, params, filters, only_plant_ids=_scope(current_user)
    )
    return Page(
        items=employee_responses(session, employees),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/import/template.xlsx")
def download_template(
    _: CurrentUser = Depends(changer), session: Session = Depends(get_session)
) -> Response:
    return Response(
        content=import_excel.build_template(session),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="upasthiti-employees-template.xlsx"'},
    )


@router.get("/{employee_id}", response_model=EmployeeDetailResponse)
def get_employee(
    employee_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> EmployeeDetailResponse:
    employee = queries.get_employee(session, employee_id, only_plant_ids=_scope(current_user))
    return employee_detail(
        session,
        employee,
        queries.shift_history(session, employee.id),
        queries.plant_history(session, employee.id),
    )


@router.get("/{employee_id}/timeline", response_model=list[TimelineEventResponse])
def employee_timeline(
    employee_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[TimelineEventResponse]:
    employee = queries.get_employee(session, employee_id, only_plant_ids=_scope(current_user))
    return [
        TimelineEventResponse.model_validate(event, from_attributes=True)
        for event in queries.timeline(session, employee.id)
    ]


# --- Creating and changing ---------------------------------------------------------------


@router.post("", status_code=201, response_model=EmployeeResponse)
def create_employee(
    body: CreateEmployeeRequest,
    current_user: CurrentUser = Depends(changer),
    session: Session = Depends(get_session),
) -> Any:
    values = EmployeeValues(
        employee_code=body.employee_code,
        full_name=body.full_name,
        type=body.type,
        plant_id=body.plant_id,
        category_id=body.category_id,
        department_id=body.department_id,
        shift_id=body.shift_id,
        contractor_id=body.contractor_id,
        punch_method=body.punch_method or default_punch_method(body.type),
        hourly_rate=body.hourly_rate,
        ot_rate_per_hour=body.ot_rate_per_hour,
        joined_on=body.joined_on,
    )
    if _needs_approval(current_user):
        summary = f"Add {body.full_name} ({body.employee_code.upper()})"
        request = approvals.create_request(
            session,
            actor=current_user.actor,
            kind=RequestKind.CREATE,
            payload={"values": values_to_json(values)},
            summary=summary,
            plant_ids=[body.plant_id],
        )
        return _accepted(request.id, summary)
    employee = operations.create_employee(
        session, operations.AuditContext(current_user.actor), values
    )
    session.commit()
    return _one(session, employee)


@router.patch("/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: uuid.UUID,
    body: UpdateEmployeeRequest,
    current_user: CurrentUser = Depends(changer),
    session: Session = Depends(get_session),
) -> Any:
    employee = queries.get_employee(session, employee_id, only_plant_ids=_scope(current_user))
    changes = body.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    shift_from = changes.pop("shift_from", None)
    if not changes:
        raise ApiError("VALIDATION_FAILED", "Nothing to change.", 422)

    if _needs_approval(current_user):
        summary = f"Edit {employee.full_name} ({employee.employee_code})"
        request = approvals.create_request(
            session,
            actor=current_user.actor,
            kind=RequestKind.UPDATE,
            payload={
                "employee_id": str(employee.id),
                "changes": to_json({**changes, "shift_from": shift_from}),
                "reason": reason,
            },
            summary=summary,
            employee_id=employee.id,
            plant_ids=[employee.plant_id],
        )
        return _accepted(request.id, summary)
    operations.update_employee(
        session,
        operations.AuditContext(current_user.actor),
        employee,
        changes,
        shift_from=shift_from,
        reason=reason,
    )
    session.commit()
    return _one(session, employee)


@router.post("/{employee_id}/transfer", response_model=EmployeeResponse)
def transfer_employee(
    employee_id: uuid.UUID,
    body: TransferRequest,
    current_user: CurrentUser = Depends(changer),
    session: Session = Depends(get_session),
) -> Any:
    employee = queries.get_employee(session, employee_id, only_plant_ids=_scope(current_user))
    details = body.model_dump()
    if _needs_approval(current_user):
        summary = f"Transfer {employee.full_name} ({employee.employee_code})"
        request = approvals.create_request(
            session,
            actor=current_user.actor,
            kind=RequestKind.TRANSFER,
            payload={"employee_id": str(employee.id), "transfer": to_json(details)},
            summary=summary,
            employee_id=employee.id,
            plant_ids=[employee.plant_id, body.to_plant_id],
        )
        return _accepted(request.id, summary)
    operations.transfer_employee(
        session, operations.AuditContext(current_user.actor), employee, **details
    )
    session.commit()
    return _one(session, employee)


@router.post("/bulk", response_model=BulkResponse)
def bulk_change(
    body: BulkRequest,
    current_user: CurrentUser = Depends(changer),
    session: Session = Depends(get_session),
) -> Any:
    if body.action == "mark_left" and current_user.access(Capability.MARK_EMPLOYEE_LEFT) is None:
        raise ApiError("FORBIDDEN", "Only the Super Admin marks people as left.", 403)
    employees = queries.get_employees(
        session, body.employee_ids, only_plant_ids=_scope(current_user)
    )
    if _needs_approval(current_user):
        summary = f"Bulk {body.action.replace('_', ' ')} for {len(employees)} employee(s)"
        request = approvals.create_request(
            session,
            actor=current_user.actor,
            kind=RequestKind.BULK,
            payload={
                "employee_ids": [str(employee.id) for employee in employees],
                "action": body.action,
                "params": body.params,
                "reason": body.reason,
            },
            summary=summary,
            plant_ids=[employee.plant_id for employee in employees],
        )
        return _accepted(request.id, summary)
    updated = operations.bulk_change(
        session,
        operations.AuditContext(current_user.actor),
        employees,
        action=body.action,
        params=body.params,
        reason=body.reason,
    )
    session.commit()
    return BulkResponse(updated=updated)


@router.post("/import", response_model=ImportResponse)
async def import_employees(
    dry_run: bool = True,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(changer),
    session: Session = Depends(get_session),
) -> Any:
    content = await file.read(import_excel.MAX_FILE_BYTES + 1)
    raw_rows = import_excel.read_rows(content)
    checked = import_excel.check_rows(session, raw_rows)
    errors = [ImportRowError(**error.__dict__) for error in checked.errors]
    error_rows = len({error.row for error in checked.errors})
    summary = ImportResponse(ok_rows=len(checked.values), error_rows=error_rows, errors=errors)
    if dry_run:
        return summary
    if checked.errors:
        raise ApiError(
            "IMPORT_HAS_ERRORS",
            "Fix the rows with errors; nothing was saved.",
            422,
            {"errors": [error.model_dump() for error in errors[:200]]},
        )
    if not checked.values:
        raise ApiError("IMPORT_FILE_INVALID", "The file has no employee rows.", 422)

    if _needs_approval(current_user):
        request_summary = (
            f"Import {len(checked.values)} employee(s) from {file.filename or 'Excel'}"
        )
        request = approvals.create_request(
            session,
            actor=current_user.actor,
            kind=RequestKind.IMPORT,
            payload={"rows": checked.rows, "file_name": file.filename},
            summary=request_summary,
            plant_ids=[values.plant_id for values in checked.values],
        )
        return _accepted(request.id, request_summary)

    context = operations.AuditContext(current_user.actor)
    created = [operations.create_employee(session, context, values) for values in checked.values]
    record_audit(
        session,
        actor=current_user.actor,
        action="employee.import",
        entity_type="import",
        after={"file_name": file.filename, "rows": len(checked.values)},
    )
    session.commit()
    summary.created = len(created)
    # The "Issue and print cards" step uses these (F-38): everyone new, and those who punch by QR.
    summary.created_employee_ids = [employee.id for employee in created]
    summary.created_qr_employee_ids = [
        employee.id for employee in created if employee.punch_method == PunchMethod.QR.value
    ]
    return summary


# --- Leaving and coming back (Super Admin only) --------------------------------------------


@router.post("/{employee_id}/mark-left", response_model=EmployeeResponse)
def mark_left(
    employee_id: uuid.UUID,
    body: MarkLeftRequest,
    current_user: CurrentUser = Depends(leaver),
    session: Session = Depends(get_session),
) -> EmployeeResponse:
    employee = queries.get_employee(session, employee_id, only_plant_ids=None)
    operations.mark_left(
        session,
        operations.AuditContext(current_user.actor),
        employee,
        left_on=body.left_on,
        reason=body.reason,
    )
    session.commit()
    return _one(session, employee)


@router.post("/{employee_id}/reactivate", response_model=EmployeeResponse)
def reactivate(
    employee_id: uuid.UUID,
    body: ReactivateRequest,
    current_user: CurrentUser = Depends(leaver),
    session: Session = Depends(get_session),
) -> EmployeeResponse:
    employee = queries.get_employee(session, employee_id, only_plant_ids=None)
    operations.reactivate(
        session,
        operations.AuditContext(current_user.actor),
        employee,
        joined_on=body.joined_on,
        reason=body.reason,
    )
    session.commit()
    return _one(session, employee)
