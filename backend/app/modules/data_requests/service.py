"""The data-request register (M6 spec 7.7, R-12): add a request, add steps, list, show.

A person's request under the DPDP Act (see my data, correct it, erase it, withdraw consent,
complain) must be answered in `data_request_days` (30 by default). Rows are only ever added.
The state of a request is its LAST event, so nothing can drift. The audit log records the kind,
the ids and the step, never the free-text note or detail (they may hold personal words).
"""

import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams
from app.core.time import today_ist
from app.modules.attendance.models import AttendanceDay
from app.modules.audit.models import AuditLog
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.data_requests.models import DataRequest, DataRequestEvent
from app.modules.data_requests.schemas import (
    AddEventRequest,
    CreateDataRequest,
    DataRequestDetailResponse,
    DataRequestResponse,
    EventResponse,
    RequestStatus,
)
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.punches.models import Punch
from app.modules.settings.service import get_int_setting
from app.modules.users.models import User

# Which step may follow which (spec 7.7 rule 2). `action_taken` may repeat; nothing follows
# `closed`. A request with no step yet can only start with the identity check.
NEXT_STEPS: dict[str | None, tuple[str, ...]] = {
    None: ("identity_checked",),
    "identity_checked": ("action_taken",),
    "action_taken": ("action_taken", "answer_sent"),
    "answer_sent": ("closed",),
}
STATUS_AFTER_STEP: dict[str | None, RequestStatus] = {
    None: "open",
    "identity_checked": "identity_checked",
    "action_taken": "in_progress",
    "answer_sent": "answered",
    "closed": "closed",
}
# The status filter of the list, written as "the last event type is ...".
LAST_EVENT_OF_STATUS = {
    "identity_checked": "identity_checked",
    "in_progress": "action_taken",
    "answered": "answer_sent",
    "closed": "closed",
}
MIN_REASON_LENGTH = 10
KEPT_RECORDS_TEXT = "Attendance and audit records are kept as the Labour Codes require."
DUE_SOON_DAYS = 5


def _invalid(field: str, message: str) -> ApiError:
    return ApiError("VALIDATION_FAILED", message, 422, {"field": field})


# --- Reading --------------------------------------------------------------------------------


def _last_event_type_column() -> Any:
    """A column holding the type of the newest event of the request (NULL when it has none)."""
    return (
        select(DataRequestEvent.event_type)
        .where(DataRequestEvent.data_request_id == DataRequest.id)
        .order_by(DataRequestEvent.seq.desc())
        .limit(1)
        .correlate(DataRequest)
        .scalar_subquery()
    )


def _list_statement(
    *,
    status: RequestStatus | None,
    kind: str | None,
    overdue: bool | None,
    due_soon: bool | None,
    today: date,
) -> Select[Any]:
    last_type = _last_event_type_column().label("last_event_type")
    statement: Select[Any] = select(DataRequest, last_type)
    if kind is not None:
        statement = statement.where(DataRequest.kind == kind)
    if status == "open":
        statement = statement.where(
            ~exists().where(DataRequestEvent.data_request_id == DataRequest.id)
        )
    elif status is not None:
        statement = statement.where(_last_event_type_column() == LAST_EVENT_OF_STATUS[status])
    not_closed = or_(_last_event_type_column().is_(None), _last_event_type_column() != "closed")
    if overdue is True:
        statement = statement.where(DataRequest.due_on < today, not_closed)
    elif overdue is False:
        statement = statement.where(or_(DataRequest.due_on >= today, ~not_closed))
    if due_soon:
        statement = statement.where(
            DataRequest.due_on <= today + timedelta(days=DUE_SOON_DAYS), not_closed
        )
    # Requests still open come first, the most urgent on top; closed ones sink to the bottom.
    return statement.order_by(
        (last_type == "closed").asc().nulls_first(), DataRequest.due_on, DataRequest.id
    )


def _person(session: Session, employee_ids: set[uuid.UUID]) -> dict[uuid.UUID, Employee]:
    if not employee_ids:
        return {}
    rows = session.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    return {employee.id: employee for employee in rows}


def _outcomes(session: Session, request_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not request_ids:
        return {}
    rows = session.execute(
        select(DataRequestEvent.data_request_id, DataRequestEvent.outcome).where(
            DataRequestEvent.data_request_id.in_(request_ids), DataRequestEvent.outcome.is_not(None)
        )
    )
    return {request_id: outcome for request_id, outcome in rows if outcome is not None}


def _present(
    request: DataRequest,
    last_event_type: str | None,
    employees: dict[uuid.UUID, Employee],
    outcomes: dict[uuid.UUID, str],
    today: date,
) -> dict[str, Any]:
    employee = employees.get(request.employee_id) if request.employee_id else None
    status = STATUS_AFTER_STEP[last_event_type]
    return {
        "id": request.id,
        "kind": request.kind,
        "channel": request.channel,
        "received_on": request.received_on,
        "due_on": request.due_on,
        "note": request.note,
        "status": status,
        "outcome": outcomes.get(request.id),
        "days_left": None if status == "closed" else (request.due_on - today).days,
        "employee_id": request.employee_id,
        "employee_code": employee.employee_code if employee else None,
        "employee_name": employee.full_name if employee else None,
        "employee_left": employee is not None and employee.status == EmployeeStatus.LEFT.value,
        "created_at": request.created_at,
    }


def list_requests(
    session: Session,
    params: PageParams,
    *,
    status: RequestStatus | None,
    kind: str | None,
    overdue: bool | None,
    due_soon: bool | None,
) -> tuple[list[DataRequestResponse], int]:
    today = today_ist()
    rows, total = _fetch(session, params, status, kind, overdue, due_soon, today)
    employees = _person(session, {row[0].employee_id for row in rows if row[0].employee_id})
    outcomes = _outcomes(session, [row[0].id for row in rows])
    items = [
        DataRequestResponse(**_present(request, last_type, employees, outcomes, today))
        for request, last_type in rows
    ]
    return items, total


def _fetch(
    session: Session,
    params: PageParams,
    status: RequestStatus | None,
    kind: str | None,
    overdue: bool | None,
    due_soon: bool | None,
    today: date,
) -> tuple[list[Any], int]:
    statement = _list_statement(
        status=status, kind=kind, overdue=overdue, due_soon=due_soon, today=today
    )
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = list(session.execute(statement.offset(params.offset).limit(params.page_size)).all())
    return rows, total or 0


def _get_request(session: Session, request_id: uuid.UUID) -> DataRequest:
    request = session.get(DataRequest, request_id)
    if request is None:
        raise ApiError("DATA_REQUEST_NOT_FOUND", "This request was not found.", 404)
    return request


def _events_of(session: Session, request_id: uuid.UUID) -> list[DataRequestEvent]:
    return list(
        session.scalars(
            select(DataRequestEvent)
            .where(DataRequestEvent.data_request_id == request_id)
            .order_by(DataRequestEvent.seq)
        )
    )


def get_request_detail(session: Session, request_id: uuid.UUID) -> DataRequestDetailResponse:
    request = _get_request(session, request_id)
    events = _events_of(session, request.id)
    names = {
        user.id: user.name
        for user in session.scalars(select(User).where(User.id.in_({e.created_by for e in events})))
    }
    last_type = events[-1].event_type if events else None
    employees = _person(session, {request.employee_id} if request.employee_id else set())
    outcomes = {request.id: events[-1].outcome} if events and events[-1].outcome else {}
    base = _present(request, last_type, employees, outcomes, today_ist())
    return DataRequestDetailResponse(
        **base,
        events=[
            EventResponse(
                id=event.id,
                event_type=event.event_type,  # type: ignore[arg-type]
                detail=event.detail,
                outcome=event.outcome,  # type: ignore[arg-type]
                audit_entry_id=event.audit_entry_id,
                created_by=event.created_by,
                created_by_name=names.get(event.created_by),
                created_at=event.created_at,
            )
            for event in events
        ],
    )


# --- Writing --------------------------------------------------------------------------------


def create_request(
    session: Session, current_user: CurrentUser, body: CreateDataRequest
) -> DataRequestDetailResponse:
    if body.received_on > today_ist():
        raise _invalid("received_on", "The request cannot be received in the future.")
    employee = None
    if body.employee_id is not None:
        employee = session.get(Employee, body.employee_id)
        if employee is None:
            raise ApiError("NOT_FOUND", "Employee not found.", 404)
    due_on = body.received_on + timedelta(days=get_int_setting(session, "data_request_days"))
    request = DataRequest(
        kind=body.kind,
        employee_id=body.employee_id,
        channel=body.channel,
        received_on=body.received_on,
        due_on=due_on,
        note=(body.note or "").strip() or None,
        created_by=current_user.id,
    )
    session.add(request)
    session.flush()
    record_audit(
        session,
        actor=current_user.actor,
        action="data_request.create",
        entity_type="data_request",
        entity_id=request.id,
        # Never the note text: it is free text and may hold personal words.
        after={
            "kind": request.kind,
            "channel": request.channel,
            "received_on": request.received_on,
            "due_on": request.due_on,
            "employee_id": request.employee_id,
        },
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()
    return get_request_detail(session, request.id)


def add_event(
    session: Session, current_user: CurrentUser, request_id: uuid.UUID, body: AddEventRequest
) -> EventResponse:
    request = _get_request(session, request_id)
    events = _events_of(session, request.id)
    last_type = events[-1].event_type if events else None
    if last_type == "closed":
        raise ApiError(
            "DATA_REQUEST_CLOSED", "This request is already closed. Nothing more can be added.", 409
        )
    if body.event_type not in NEXT_STEPS[last_type]:
        raise ApiError(
            "DATA_REQUEST_STEP_INVALID",
            "This step cannot be added now. Check the steps that came before.",
            409,
        )
    detail = body.detail.strip()
    if not detail:
        raise _invalid("detail", "Please say what was done.")
    _check_outcome(session, request, body, detail)
    if body.audit_entry_id is not None and session.get(AuditLog, body.audit_entry_id) is None:
        raise _invalid("audit_entry_id", "The audit entry was not found.")

    event = DataRequestEvent(
        data_request_id=request.id,
        event_type=body.event_type,
        detail=detail,
        outcome=body.outcome,
        audit_entry_id=body.audit_entry_id,
        created_by=current_user.id,
    )
    session.add(event)
    session.flush()
    record_audit(
        session,
        actor=current_user.actor,
        action="data_request.event",
        entity_type="data_request",
        entity_id=request.id,
        # The kind and the step only; never the detail text.
        after={"kind": request.kind, "event_type": event.event_type, "outcome": event.outcome},
    )
    session.commit()
    session.refresh(event)
    return EventResponse(
        id=event.id,
        event_type=event.event_type,  # type: ignore[arg-type]
        detail=event.detail,
        outcome=event.outcome,  # type: ignore[arg-type]
        audit_entry_id=event.audit_entry_id,
        created_by=event.created_by,
        created_by_name=current_user.user.name,
        created_at=event.created_at,
    )


def _check_outcome(
    session: Session, request: DataRequest, body: AddEventRequest, detail: str
) -> None:
    """The closing rules of spec 7.7 rule 3 (an outcome belongs to the closing step only)."""
    if body.event_type != "closed":
        if body.outcome is not None:
            raise _invalid("outcome", "Only the closing step has an outcome.")
        return
    if body.outcome is None:
        raise _invalid("outcome", "Please choose how the request was closed.")
    if body.outcome != "done" and len(detail) < MIN_REASON_LENGTH:
        raise _invalid("detail", "Please give a reason of at least 10 characters.")
    # Erasure: attendance, punch and audit rows are kept by law, so it is never fully "done".
    if (
        request.kind == "erasure"
        and body.outcome != "partly_done"
        and _person_has_kept_records(session, request.employee_id)
    ):
        raise _invalid(
            "outcome",
            "Attendance and audit records are kept as the Labour Codes require. "
            "Close this request as partly done.",
        )


def _person_has_kept_records(session: Session, employee_id: uuid.UUID | None) -> bool:
    """True when punch, attendance or audit rows about this person exist (never deleted)."""
    if employee_id is None:
        return False
    return bool(
        session.scalar(
            select(
                or_(
                    exists().where(Punch.employee_id == employee_id),
                    exists().where(AttendanceDay.employee_id == employee_id),
                    exists().where(
                        and_(AuditLog.entity_type == "employee", AuditLog.entity_id == employee_id)
                    ),
                )
            )
        )
    )
