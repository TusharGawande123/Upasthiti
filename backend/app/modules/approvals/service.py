"""The approvals inbox (decision 0005, spec §7 rule 11).

A Corporate Head's employee change is never applied directly. Instead:
1. it is TRIED inside a savepoint that is always rolled back, so the Corporate Head sees
   any error at once and nothing changes;
2. it is SAVED as a pending change request;
3. when a Super Admin approves, it runs AGAIN for real (the data may have changed in the
   meantime); if a check fails now, nothing is applied and the request becomes "failed".
"""

import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.core.time import utc_now
from app.modules.approvals.models import ChangeRequest, RequestKind, RequestStatus
from app.modules.approvals.payloads import from_json, values_from_json
from app.modules.audit.service import Actor, record_audit
from app.modules.employees import operations
from app.modules.employees.import_excel import values_from_saved_rows
from app.modules.employees.models import Employee


def try_without_saving(session: Session, change: Callable[[], Any]) -> None:
    """Run `change` to see whether it would work, then undo it (raises its ApiError)."""
    savepoint = session.begin_nested()
    try:
        change()
        session.flush()
    finally:
        savepoint.rollback()


def apply_payload(
    session: Session, context: operations.AuditContext, kind: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Apply a stored change. Used both when trying it and when approving it."""
    if kind == RequestKind.CREATE.value:
        employee = operations.create_employee(session, context, values_from_json(payload["values"]))
        return {"employee_ids": [str(employee.id)]}
    if kind == RequestKind.UPDATE.value:
        details = from_json(payload["changes"])
        shift_from = details.pop("shift_from", None)
        operations.update_employee(
            session,
            context,
            _employee(session, payload["employee_id"]),
            details,
            shift_from=shift_from,
            reason=payload.get("reason"),
        )
        return {"employee_ids": [payload["employee_id"]]}
    if kind == RequestKind.TRANSFER.value:
        details = from_json(payload["transfer"])
        operations.transfer_employee(
            session, context, _employee(session, payload["employee_id"]), **details
        )
        return {"employee_ids": [payload["employee_id"]]}
    if kind == RequestKind.BULK.value:
        employees = [_employee(session, employee_id) for employee_id in payload["employee_ids"]]
        operations.bulk_change(
            session,
            context,
            employees,
            action=payload["action"],
            params=payload.get("params", {}),
            reason=payload["reason"],
        )
        return {"employee_ids": payload["employee_ids"]}
    if kind == RequestKind.IMPORT.value:
        checked = values_from_saved_rows(session, payload["rows"])
        if checked.errors:
            raise ApiError(
                "IMPORT_HAS_ERRORS",
                "Some rows are no longer valid.",
                422,
                {"errors": [error.__dict__ for error in checked.errors[:50]]},
            )
        created = [
            operations.create_employee(session, context, values) for values in checked.values
        ]
        return {"employee_ids": [str(employee.id) for employee in created]}
    raise ApiError("VALIDATION_FAILED", "Unknown change.", 422)


def create_request(
    session: Session,
    *,
    actor: Actor,
    kind: RequestKind,
    payload: dict[str, Any],
    summary: str,
    employee_id: uuid.UUID | None = None,
    plant_ids: list[uuid.UUID],
) -> ChangeRequest:
    """Try the change, then store it as pending. The caller has checked the role."""
    if employee_id is not None and _has_pending_request(session, employee_id):
        raise ApiError(
            "CHANGE_ALREADY_PENDING", "A change for this employee is waiting for approval.", 409
        )
    try_without_saving(
        session,
        lambda: apply_payload(session, operations.AuditContext(actor), kind.value, payload),
    )
    request = ChangeRequest(
        kind=kind.value,
        employee_id=employee_id,
        plant_ids=sorted(set(plant_ids)),
        payload=payload,
        summary=summary,
        requested_by=actor.actor_id,
    )
    session.add(request)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise ApiError(
            "CHANGE_ALREADY_PENDING", "A change for this employee is waiting for approval.", 409
        ) from None
    _audit(session, actor, request, "change_request.create")
    session.commit()
    return request


def approve(
    session: Session, *, actor: Actor, request: ChangeRequest, note: str | None
) -> ChangeRequest:
    _check_pending(request)
    context = operations.AuditContext(actor, change_request_id=request.id)
    savepoint = session.begin_nested()
    try:
        # Marked approved first, so its own employee codes no longer count as "waiting".
        request.status = RequestStatus.APPROVED.value
        session.flush()
        result = apply_payload(session, context, request.kind, request.payload)
        session.flush()
        savepoint.commit()
    except ApiError as error:
        savepoint.rollback()
        request.status = RequestStatus.FAILED.value
        request.result = {
            "errors": [{"code": error.code, "message": error.message, **error.details}]
        }
        _decide(request, actor, note)
        _audit(session, actor, request, "change_request.failed")
        session.commit()
        raise ApiError(
            "REQUEST_CHECK_FAILED",
            "This change can no longer be applied.",
            409,
            {"reason": error.code, **error.details},
        ) from None

    request.status = RequestStatus.APPROVED.value
    request.result = result
    _decide(request, actor, note)
    _audit(session, actor, request, "change_request.approve")
    session.commit()
    return request


def reject(session: Session, *, actor: Actor, request: ChangeRequest, reason: str) -> ChangeRequest:
    _check_pending(request)
    request.status = RequestStatus.REJECTED.value
    _decide(request, actor, reason)
    _audit(session, actor, request, "change_request.reject", reason=reason)
    session.commit()
    return request


def withdraw(session: Session, *, actor: Actor, request: ChangeRequest) -> ChangeRequest:
    _check_pending(request)
    if request.requested_by != actor.actor_id:
        raise ApiError("NOT_FOUND", "Request not found.", 404)
    request.status = RequestStatus.WITHDRAWN.value
    request.decided_at = utc_now()
    _audit(session, actor, request, "change_request.withdraw")
    session.commit()
    return request


def list_requests(
    session: Session,
    params: PageParams,
    *,
    requested_by: uuid.UUID | None,
    status: str | None,
    kind: str | None,
) -> tuple[list[ChangeRequest], int]:
    statement = select(ChangeRequest).order_by(ChangeRequest.requested_at.desc())
    if requested_by is not None:
        statement = statement.where(ChangeRequest.requested_by == requested_by)
    if status:
        statement = statement.where(ChangeRequest.status == status)
    if kind:
        statement = statement.where(ChangeRequest.kind == kind)
    return fetch_page(session, statement, params)


def pending_count(session: Session) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(ChangeRequest)
            .where(ChangeRequest.status == RequestStatus.PENDING.value)
        )
        or 0
    )


def get_request(session: Session, request_id: uuid.UUID) -> ChangeRequest:
    request = session.get(ChangeRequest, request_id)
    if request is None:
        raise ApiError("NOT_FOUND", "Request not found.", 404)
    return request


def _employee(session: Session, employee_id: str) -> Employee:
    employee = session.get(Employee, uuid.UUID(employee_id))
    if employee is None:
        raise ApiError("EMPLOYEE_NOT_FOUND", "Employee not found.", 404)
    return employee


def _has_pending_request(session: Session, employee_id: uuid.UUID) -> bool:
    return (
        session.scalar(
            select(ChangeRequest.id).where(
                ChangeRequest.employee_id == employee_id,
                ChangeRequest.status == RequestStatus.PENDING.value,
            )
        )
        is not None
    )


def _check_pending(request: ChangeRequest) -> None:
    if request.status != RequestStatus.PENDING.value:
        raise ApiError("REQUEST_NOT_PENDING", "This request was already handled.", 409)


def _decide(request: ChangeRequest, actor: Actor, reason: str | None) -> None:
    request.decided_by = actor.actor_id
    request.decided_at = utc_now()
    request.decision_reason = reason


def _audit(
    session: Session, actor: Actor, request: ChangeRequest, action: str, reason: str | None = None
) -> None:
    record_audit(
        session,
        actor=actor,
        action=action,
        entity_type="change_request",
        entity_id=request.id,
        after={"kind": request.kind, "status": request.status, "summary": request.summary},
        reason=reason,
        plant_id=request.plant_ids[0] if len(request.plant_ids) == 1 else None,
        change_request_id=request.id,
    )
