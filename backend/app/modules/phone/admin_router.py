"""The admin side of phone punching on the employee page (M4b spec §5.5, §7 rules 1, 3, 29).

Reading: Super Admin (with IPs), Corporate Head (all plants) and Plant Head (own plant), without
IPs. Every change: Super Admin only, with a reason, audited. A Corporate Head can never ask for
phone access through the approvals inbox (lead decision 5).
"""

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.employees.queries import get_employee
from app.modules.phone import access_service, views
from app.modules.phone.schemas import (
    AccessRequest,
    OutsideWorkRequest,
    PhoneAccessView,
    Reason,
    SignOutAllResponse,
)
from app.modules.users.models import Role

router = APIRouter(prefix="/employees", tags=["phone"])
viewer = require(Capability.VIEW_PHONE_ACCESS)
manager = require(Capability.MANAGE_PHONE_ACCESS)


def _employee(
    session: Session, user: CurrentUser, capability: Capability, employee_id: uuid.UUID
) -> Employee:
    return get_employee(session, employee_id, only_plant_ids=plant_filter(user, capability))


def _view(session: Session, user: CurrentUser, employee: Employee) -> PhoneAccessView:
    return views.admin_view(session, employee, show_ip=user.role == Role.SUPER_ADMIN.value)


@router.get("/{employee_id}/phone", response_model=PhoneAccessView)
def phone_access(
    employee_id: uuid.UUID,
    user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> PhoneAccessView:
    return _view(session, user, _employee(session, user, Capability.VIEW_PHONE_ACCESS, employee_id))


@router.put("/{employee_id}/phone/access", response_model=PhoneAccessView)
def set_access(
    employee_id: uuid.UUID,
    body: AccessRequest,
    user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> PhoneAccessView:
    employee = _employee(session, user, Capability.MANAGE_PHONE_ACCESS, employee_id)
    access_service.set_phone_punching(
        session, user.actor, employee, enabled=body.phone_punch_enabled, reason=body.reason
    )
    return _view(session, user, employee)


@router.put("/{employee_id}/phone/outside-work", response_model=PhoneAccessView)
def set_outside_work(
    employee_id: uuid.UUID,
    body: OutsideWorkRequest,
    user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> PhoneAccessView:
    employee = _employee(session, user, Capability.MANAGE_PHONE_ACCESS, employee_id)
    access_service.set_outside_work(
        session, user.actor, employee, allowed=body.allowed, reason=body.reason, until=body.until
    )
    return _view(session, user, employee)


@router.post("/{employee_id}/phone/sign-out-all", response_model=SignOutAllResponse)
def sign_out_all(
    employee_id: uuid.UUID,
    body: Reason,
    user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> SignOutAllResponse:
    employee = _employee(session, user, Capability.MANAGE_PHONE_ACCESS, employee_id)
    return SignOutAllResponse(
        ended=access_service.sign_out_all(session, user.actor, employee, reason=body.reason)
    )


@router.post("/{employee_id}/phone/require-new-password", response_model=PhoneAccessView)
def require_new_password(
    employee_id: uuid.UUID,
    body: Reason,
    user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> PhoneAccessView:
    employee = _employee(session, user, Capability.MANAGE_PHONE_ACCESS, employee_id)
    access_service.require_new_password(session, user.actor, employee, reason=body.reason)
    return _view(session, user, employee)


@router.post("/{employee_id}/phone/passkeys/{passkey_id}/remove", status_code=204)
def remove_passkey(
    employee_id: uuid.UUID,
    passkey_id: uuid.UUID,
    body: Reason,
    user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> Response:
    employee = _employee(session, user, Capability.MANAGE_PHONE_ACCESS, employee_id)
    access_service.remove_passkey_by_admin(
        session, user.actor, employee, passkey_id, reason=body.reason
    )
    return Response(status_code=204)
