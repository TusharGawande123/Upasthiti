"""Face consent endpoints (spec M3 §5.3). Recording and withdrawing consent: Super Admin only."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.employees.queries import get_employee
from app.modules.face import consent_service
from app.modules.face.consent_texts import consent_text
from app.modules.face.presenter import consent_view
from app.modules.face.schemas import (
    ConsentTextResponse,
    RecordConsentRequest,
    RecordConsentResponse,
    WithdrawConsentRequest,
    WithdrawConsentResponse,
)

router = APIRouter(tags=["face"])
viewer = require(Capability.VIEW_FACE_ENROLMENT)
manager = require(Capability.MANAGE_FACE_ENROLMENT)


def _employee_for_change(
    session: Session, current_user: CurrentUser, employee_id: uuid.UUID
) -> Employee:
    scope = plant_filter(current_user, Capability.MANAGE_FACE_ENROLMENT)
    return get_employee(session, employee_id, only_plant_ids=scope)


@router.get("/face/consent-texts/{version}", response_model=ConsentTextResponse)
def read_consent_text(
    version: str,
    language: str = Query(default="en", pattern="^(en|mr|hi)$"),
    _: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> ConsentTextResponse:
    shown = consent_text(session, version, language)
    return ConsentTextResponse(
        version=shown.version,
        language=shown.language,
        text=shown.text,
        text_sha256=shown.text_sha256,
    )


@router.post(
    "/employees/{employee_id}/face/consent",
    response_model=RecordConsentResponse,
    status_code=201,
)
def record_consent(
    employee_id: uuid.UUID,
    body: RecordConsentRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> RecordConsentResponse:
    employee = _employee_for_change(session, current_user, employee_id)
    consent = consent_service.record_consent(
        session,
        current_user.actor,
        employee,
        text_version=body.text_version,
        language=body.language,
        choice=body.choice,
        explained_language=body.explained_language,
    )
    return RecordConsentResponse(
        consent=consent_view(session, consent), punch_method=employee.punch_method
    )


@router.post(
    "/employees/{employee_id}/face/consent/withdraw", response_model=WithdrawConsentResponse
)
def withdraw_consent(
    employee_id: uuid.UUID,
    body: WithdrawConsentRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> WithdrawConsentResponse:
    employee = _employee_for_change(session, current_user, employee_id)
    reason = body.reason.strip() if body.reason and body.reason.strip() else None
    result = consent_service.withdraw_consent(session, current_user.actor, employee, reason=reason)
    return WithdrawConsentResponse(
        consent=consent_view(session, result.consent),
        punch_method="qr",
        template_deleted=result.template_deleted,
    )
