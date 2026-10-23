"""Face consent endpoints (spec M3 §5.3). Recording and withdrawing consent: Super Admin only."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.face.engine import FaceEngine
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.rate_limit import enrolment_shot_limiter
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.employees.queries import get_employee
from app.modules.face import consent_service, enrolment_service
from app.modules.face.consent_texts import consent_text
from app.modules.face.engine_provider import get_face_engine, running_model_id
from app.modules.face.models import ENROLMENT_POSES
from app.modules.face.presenter import (
    consent_view,
    employee_face,
    progress_response,
    template_view,
)
from app.modules.face.schemas import (
    ConsentTextResponse,
    DeleteFaceDataRequest,
    DeleteFaceDataResponse,
    EmployeeFaceResponse,
    EnrolmentProgressResponse,
    FinishEnrolmentRequest,
    FinishEnrolmentResponse,
    RecordConsentRequest,
    RecordConsentResponse,
    ShotQualityView,
    ShotRequest,
    ShotResponse,
    StartEnrolmentResponse,
    WithdrawConsentRequest,
    WithdrawConsentResponse,
)
from app.modules.face.state import enrolment_progress

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


# --- Enrolment (spec §5.4) ------------------------------------------------------------------


@router.post(
    "/employees/{employee_id}/face/enrolment-sessions",
    response_model=StartEnrolmentResponse,
    status_code=201,
)
def start_enrolment(
    employee_id: uuid.UUID,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> StartEnrolmentResponse:
    employee = _employee_for_change(session, current_user, employee_id)
    row = enrolment_service.start_session(session, current_user.actor, employee, engine)
    return StartEnrolmentResponse(
        session_id=row.id,
        expires_at=row.expires_at,
        model_id=row.model_id,
        poses=list(ENROLMENT_POSES),
    )


@router.post("/face/enrolment-sessions/{session_id}/shots", response_model=ShotResponse)
def add_shot(
    session_id: uuid.UUID,
    body: ShotRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> ShotResponse:
    if not enrolment_shot_limiter.allow(str(current_user.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many pictures. Wait a moment.", 429)
    answer = enrolment_service.add_shot(
        session,
        current_user.id,
        session_id,
        pose=body.pose,
        image_base64=body.image_jpeg,
        engine=engine,
    )
    quality = answer.result.quality
    return ShotResponse(
        accepted=answer.result.accepted,
        reason_code=answer.result.reason_code,
        shots_done=answer.shots_done,
        next_pose=answer.next_pose,
        quality=ShotQualityView(
            face_px=round(quality.face_px, 1),
            sharpness=round(quality.sharpness, 1),
            brightness=round(quality.brightness, 1),
            yaw=round(quality.yaw, 1),
            pitch=round(quality.pitch, 3),
        )
        if quality
        else None,
    )


@router.post(
    "/face/enrolment-sessions/{session_id}/finish",
    response_model=FinishEnrolmentResponse,
    status_code=201,
)
def finish_enrolment(
    session_id: uuid.UUID,
    body: FinishEnrolmentRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> FinishEnrolmentResponse:
    finished = enrolment_service.finish(
        session,
        current_user.actor,
        session_id,
        duplicate_override_reason=body.duplicate_override_reason,
    )
    return FinishEnrolmentResponse(
        template=template_view(session, finished.template),
        replaced_previous=finished.replaced_previous,
    )


@router.post("/face/enrolment-sessions/{session_id}/cancel", status_code=204)
def cancel_enrolment(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> Response:
    enrolment_service.cancel(session, current_user.actor, session_id)
    return Response(status_code=204)


@router.post("/employees/{employee_id}/face/template/delete", response_model=DeleteFaceDataResponse)
def delete_face_data(
    employee_id: uuid.UUID,
    body: DeleteFaceDataRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> DeleteFaceDataResponse:
    employee = _employee_for_change(session, current_user, employee_id)
    enrolment_service.delete_face_data(
        session, current_user.actor, employee, reason=body.reason.strip()
    )
    return DeleteFaceDataResponse(template_deleted=True)


# --- Reading (spec §5.3, §5.5) --------------------------------------------------------------


@router.get("/employees/{employee_id}/face", response_model=EmployeeFaceResponse)
def read_employee_face(
    employee_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> EmployeeFaceResponse:
    scope = plant_filter(current_user, Capability.VIEW_FACE_ENROLMENT)
    employee = get_employee(session, employee_id, only_plant_ids=scope)
    return employee_face(session, employee, running_model_id())


@router.get("/face/enrolment-progress", response_model=EnrolmentProgressResponse)
def read_enrolment_progress(
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> EnrolmentProgressResponse:
    scope = plant_filter(current_user, Capability.VIEW_FACE_ENROLMENT)
    return progress_response(enrolment_progress(session, running_model_id(), scope))
