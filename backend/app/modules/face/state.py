"""What the admin sees about an employee's face data: state, consent, template, history and the
enrolment progress per plant (spec M3 §5.3, §5.5, F-40). Never a template or a score.

Face state:
- QR employees: "withdrawn" when their last consent was withdrawn, else "not_face_method";
- face employees: "enrolled" (a template of the running model), "old_model" (a template of
  another model: re-enrol), or "not_enrolled".
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, and_, exists, func, select
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.face.models import ConsentChoice, FaceConsent, FaceTemplate, WithdrawKind
from app.modules.org.models import Plant

FACE_STATES = ("enrolled", "not_enrolled", "old_model", "withdrawn", "not_face_method")


@dataclass(frozen=True)
class HistoryItem:
    kind: str  # consent_given, consent_declined, consent_withdrawn, enrolled, deleted
    at: datetime
    by: uuid.UUID | None
    detail: str | None = None  # the delete kind, for "deleted"


def face_states(session: Session, employees: list[Employee], model_id: str) -> dict[uuid.UUID, str]:
    ids = [employee.id for employee in employees]
    if not ids:
        return {}
    templates = dict(
        session.execute(
            select(FaceTemplate.employee_id, FaceTemplate.model_id).where(
                FaceTemplate.employee_id.in_(ids), FaceTemplate.deleted_at.is_(None)
            )
        ).all()
    )
    withdrawn = set(
        session.scalars(
            select(FaceConsent.employee_id).where(
                FaceConsent.employee_id.in_(ids),
                FaceConsent.withdraw_kind == WithdrawKind.WITHDRAWN.value,
                FaceConsent.given_at == _latest_consent_time(FaceConsent.employee_id),
            )
        )
    )
    return {
        employee.id: _state(
            employee, templates.get(employee.id), employee.id in withdrawn, model_id
        )
        for employee in employees
    }


def _latest_consent_time(employee_column):  # noqa: ANN001, ANN202 (an SQL expression)
    newer = FaceConsent.__table__.alias("newer")
    return (
        select(func.max(newer.c.given_at))
        .where(newer.c.employee_id == employee_column)
        .scalar_subquery()
    )


def _state(employee: Employee, template_model: str | None, withdrawn: bool, model_id: str) -> str:
    if employee.punch_method != PunchMethod.FACE.value:
        return "withdrawn" if withdrawn else "not_face_method"
    if template_model is None:
        return "not_enrolled"
    return "enrolled" if template_model == model_id else "old_model"


def face_state_condition(state: str, model_id: str) -> ColumnElement[bool]:
    """An SQL condition on Employee for the employees list filter (F-40)."""
    has_template_of_model = exists().where(
        FaceTemplate.employee_id == Employee.id,
        FaceTemplate.deleted_at.is_(None),
        FaceTemplate.model_id == model_id,
    )
    has_other_model = exists().where(
        FaceTemplate.employee_id == Employee.id,
        FaceTemplate.deleted_at.is_(None),
        FaceTemplate.model_id != model_id,
    )
    is_face = Employee.punch_method == PunchMethod.FACE.value
    if state == "enrolled":
        return and_(is_face, has_template_of_model)
    if state == "old_model":
        return and_(is_face, has_other_model)
    if state == "not_enrolled":  # also those with an old-model template: they must re-enrol
        return and_(is_face, ~has_template_of_model)
    # "reenrol_suggested" (F-41) is computed in a later step; until then nobody matches.
    return Employee.id.is_(None)


def latest_consent(session: Session, employee_id: uuid.UUID) -> FaceConsent | None:
    """The active consent, or else the most recent answer."""
    return session.scalar(
        select(FaceConsent)
        .where(FaceConsent.employee_id == employee_id)
        .order_by(
            (
                (FaceConsent.choice == ConsentChoice.AGREED.value)
                & FaceConsent.withdrawn_at.is_(None)
            ).desc(),
            FaceConsent.given_at.desc(),
        )
        .limit(1)
    )


def history(session: Session, employee_id: uuid.UUID) -> list[HistoryItem]:
    items: list[HistoryItem] = []
    for consent in session.scalars(
        select(FaceConsent).where(FaceConsent.employee_id == employee_id)
    ):
        kind = (
            "consent_given" if consent.choice == ConsentChoice.AGREED.value else "consent_declined"
        )
        items.append(HistoryItem(kind, consent.given_at, consent.recorded_by))
        if consent.withdrawn_at is not None:
            items.append(
                HistoryItem(
                    "consent_withdrawn",
                    consent.withdrawn_at,
                    consent.withdrawn_by,
                    consent.withdraw_kind,
                )
            )
    for template in session.scalars(
        select(FaceTemplate).where(FaceTemplate.employee_id == employee_id)
    ):
        items.append(HistoryItem("enrolled", template.enrolled_at, template.enrolled_by))
        if template.deleted_at is not None:
            items.append(
                HistoryItem(
                    "deleted", template.deleted_at, template.deleted_by, template.delete_kind
                )
            )
    return sorted(items, key=lambda item: item.at, reverse=True)


@dataclass(frozen=True)
class PlantProgress:
    plant_id: uuid.UUID
    plant_code: str
    plant_name: str
    face_employees: int
    enrolled: int
    old_model: int

    @property
    def not_enrolled(self) -> int:
        return self.face_employees - self.enrolled


def enrolment_progress(
    session: Session, model_id: str, only_plant_ids: frozenset[uuid.UUID] | None
) -> list[PlantProgress]:
    """F-40: per active plant, how many active face employees have a template of this model."""
    enrolled = func.count(FaceTemplate.id).filter(FaceTemplate.model_id == model_id)
    old_model = func.count(FaceTemplate.id).filter(FaceTemplate.model_id != model_id)
    statement = (
        select(Plant.id, Plant.code, Plant.name, func.count(Employee.id), enrolled, old_model)
        .outerjoin(
            Employee,
            and_(
                Employee.plant_id == Plant.id,
                Employee.status == EmployeeStatus.ACTIVE.value,
                Employee.punch_method == PunchMethod.FACE.value,
            ),
        )
        .outerjoin(
            FaceTemplate,
            and_(FaceTemplate.employee_id == Employee.id, FaceTemplate.deleted_at.is_(None)),
        )
        .where(Plant.is_active.is_(True))
        .group_by(Plant.id, Plant.code, Plant.name)
        .order_by(Plant.code)
    )
    if only_plant_ids is not None:
        statement = statement.where(Plant.id.in_(only_plant_ids))
    return [
        PlantProgress(plant_id, code, name, int(total), int(done), int(old))
        for plant_id, code, name, total, done, old in session.execute(statement).all()
    ]


def plant_has_enrolled_faces(session: Session, plant_id: uuid.UUID, model_id: str) -> bool:
    """The gate shows "Punch with face" only when someone there can use it (spec §4.1)."""
    return (
        session.scalar(
            select(Employee.id)
            .where(
                Employee.plant_id == plant_id,
                Employee.status == EmployeeStatus.ACTIVE.value,
                face_state_condition("enrolled", model_id),
            )
            .limit(1)
        )
        is not None
    )
