"""Turns face rows into API answers. Only names and dates: never ciphertext, nonce or scores."""

import uuid

from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.employees.models import Employee
from app.modules.face.models import ConsentChoice, FaceConsent, FaceTemplate
from app.modules.face.schemas import (
    ConsentView,
    EmployeeFaceResponse,
    EnrolmentProgressResponse,
    HistoryItemView,
    PersonRef,
    PlantProgressView,
    PlantRef,
    ProgressTotals,
    TemplateView,
)
from app.modules.face.state import (
    PlantProgress,
    face_states,
    history,
    latest_consent,
    reenrol_hints,
)
from app.modules.face.template_service import active_template
from app.modules.users.models import User


def person(session: Session, user_id: uuid.UUID | None) -> PersonRef | None:
    if user_id is None:
        return None
    user = session.get(User, user_id)
    return PersonRef(id=user.id, name=user.name) if user else None


def consent_view(session: Session, consent: FaceConsent) -> ConsentView:
    return ConsentView(
        choice=ConsentChoice(consent.choice),
        text_version=consent.text_version,
        language=consent.language,
        explained_language=consent.explained_language,
        given_at=consent.given_at,
        recorded_by=person(session, consent.recorded_by),
        withdrawn_at=consent.withdrawn_at,
        withdrawn_by=person(session, consent.withdrawn_by),
        withdraw_kind=consent.withdraw_kind,
        withdraw_reason=consent.withdraw_reason,
    )


def template_view(session: Session, template: FaceTemplate) -> TemplateView:
    return TemplateView(
        enrolled_at=template.enrolled_at,
        enrolled_by=person(session, template.enrolled_by),
        model_id=template.model_id,
        shot_count=template.shot_count,
        duplicate_override=template.duplicate_override_reason is not None,
    )


def employee_face(session: Session, employee: Employee, model_id: str) -> EmployeeFaceResponse:
    consent = latest_consent(session, employee.id)
    template = active_template(session, employee.id)
    hint = reenrol_hints(session, [employee.id], model_id, utc_now()).get(employee.id)
    return EmployeeFaceResponse(
        punch_method=employee.punch_method,
        face_state=face_states(session, [employee], model_id)[employee.id],
        consent=consent_view(session, consent) if consent else None,
        template=template_view(session, template) if template else None,
        reenrol_suggested=hint is not None,
        reenrol_reason=hint.reason if hint else None,
        history=[
            HistoryItemView(
                kind=item.kind, at=item.at, by=person(session, item.by), detail=item.detail
            )
            for item in history(session, employee.id)
        ],
    )


def progress_response(
    plants: list[PlantProgress], suggested_per_plant: dict[uuid.UUID, int]
) -> EnrolmentProgressResponse:
    views = [
        PlantProgressView(
            plant=PlantRef(id=row.plant_id, code=row.plant_code, name=row.plant_name),
            face_employees=row.face_employees,
            enrolled=row.enrolled,
            not_enrolled=row.not_enrolled,
            old_model=row.old_model,
            reenrol_suggested=suggested_per_plant.get(row.plant_id, 0),
        )
        for row in plants
    ]
    return EnrolmentProgressResponse(
        plants=views,
        totals=ProgressTotals(
            face_employees=sum(view.face_employees for view in views),
            enrolled=sum(view.enrolled for view in views),
            not_enrolled=sum(view.not_enrolled for view in views),
            old_model=sum(view.old_model for view in views),
            reenrol_suggested=sum(view.reenrol_suggested for view in views),
        ),
    )
