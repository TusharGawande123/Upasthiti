"""Approvals inbox endpoints (spec §5.4).

The Super Admin sees and decides every request; a Corporate Head sees and may withdraw
only their own.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.pagination import Page, PageParams, page_params
from app.modules.approvals import service
from app.modules.approvals.models import ChangeRequest
from app.modules.auth.dependencies import CurrentUser, get_current_user, require
from app.modules.auth.permissions import Capability
from app.modules.users.models import User

router = APIRouter(prefix="/change-requests", tags=["approvals"])
decider = require(Capability.DECIDE_CHANGE_REQUESTS)


class ChangeRequestResponse(BaseModel):
    id: uuid.UUID
    kind: str
    summary: str
    status: str
    employee_id: uuid.UUID | None
    plant_ids: list[uuid.UUID]
    requested_by: uuid.UUID
    requested_by_name: str | None
    requested_at: datetime
    decided_by: uuid.UUID | None
    decided_at: datetime | None
    decision_reason: str | None
    payload: dict[str, Any]
    result: dict[str, Any] | None


class NoteRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class PendingCount(BaseModel):
    count: int


def _can_see(current_user: CurrentUser, request: ChangeRequest) -> bool:
    if current_user.access(Capability.DECIDE_CHANGE_REQUESTS) is not None:
        return True
    is_requester = current_user.access(Capability.VIEW_OWN_CHANGE_REQUESTS) is not None
    return is_requester and request.requested_by == current_user.id


def _responses(session: Session, requests: list[ChangeRequest]) -> list[ChangeRequestResponse]:
    requester_ids = {request.requested_by for request in requests}
    names = (
        dict(session.execute(select(User.id, User.name).where(User.id.in_(requester_ids))).all())
        if requester_ids
        else {}
    )
    return [
        ChangeRequestResponse(
            id=request.id,
            kind=request.kind,
            summary=request.summary,
            status=request.status,
            employee_id=request.employee_id,
            plant_ids=request.plant_ids,
            requested_by=request.requested_by,
            requested_by_name=names.get(request.requested_by),
            requested_at=request.requested_at,
            decided_by=request.decided_by,
            decided_at=request.decided_at,
            decision_reason=request.decision_reason,
            payload=request.payload,
            result=request.result,
        )
        for request in requests
    ]


@router.get("", response_model=Page[ChangeRequestResponse])
def list_requests(
    status: str | None = Query(default=None, max_length=10),
    kind: str | None = Query(default=None, max_length=20),
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Page[ChangeRequestResponse]:
    if current_user.access(Capability.DECIDE_CHANGE_REQUESTS) is not None:
        requested_by = None
    elif current_user.access(Capability.VIEW_OWN_CHANGE_REQUESTS) is not None:
        requested_by = current_user.id
    else:
        raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
    requests, total = service.list_requests(
        session, params, requested_by=requested_by, status=status, kind=kind
    )
    return Page(
        items=_responses(session, requests),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/pending-count", response_model=PendingCount)
def pending_count(
    _: CurrentUser = Depends(decider), session: Session = Depends(get_session)
) -> PendingCount:
    return PendingCount(count=service.pending_count(session))


@router.get("/{request_id}", response_model=ChangeRequestResponse)
def get_request(
    request_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChangeRequestResponse:
    request = service.get_request(session, request_id)
    if not _can_see(current_user, request):
        raise ApiError("NOT_FOUND", "Request not found.", 404)
    return _responses(session, [request])[0]


@router.post("/{request_id}/approve", response_model=ChangeRequestResponse)
def approve(
    request_id: uuid.UUID,
    body: NoteRequest,
    current_user: CurrentUser = Depends(decider),
    session: Session = Depends(get_session),
) -> ChangeRequestResponse:
    request = service.approve(
        session,
        actor=current_user.actor,
        request=service.get_request(session, request_id),
        note=body.note,
    )
    return _responses(session, [request])[0]


@router.post("/{request_id}/reject", response_model=ChangeRequestResponse)
def reject(
    request_id: uuid.UUID,
    body: RejectRequest,
    current_user: CurrentUser = Depends(decider),
    session: Session = Depends(get_session),
) -> ChangeRequestResponse:
    request = service.reject(
        session,
        actor=current_user.actor,
        request=service.get_request(session, request_id),
        reason=body.reason,
    )
    return _responses(session, [request])[0]


@router.post("/{request_id}/withdraw", response_model=ChangeRequestResponse)
def withdraw(
    request_id: uuid.UUID,
    current_user: CurrentUser = Depends(require(Capability.VIEW_OWN_CHANGE_REQUESTS)),
    session: Session = Depends(get_session),
) -> ChangeRequestResponse:
    request = service.withdraw(
        session, actor=current_user.actor, request=service.get_request(session, request_id)
    )
    return _responses(session, [request])[0]
