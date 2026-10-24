"""What the admin sees about an employee's face data: state, consent, template, history and the
enrolment progress per plant (spec M3 §5.3, §5.5, F-40). Never a template or a score.

Face state:
- QR employees: "withdrawn" when their last consent was withdrawn, else "not_face_method";
- face employees: "enrolled" (a template of the running model), "old_model" (a template of
  another model: re-enrol), or "not_enrolled".
"""

import re
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

from sqlalchemy import ColumnElement, and_, exists, func, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.face.models import ConsentChoice, FaceConsent, FaceTemplate, WithdrawKind
from app.modules.org.models import Plant
from app.modules.punches.models import MatchMode, Punch, PunchDecision
from app.modules.settings.service import get_float_setting, get_int_setting

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


def list_face_states(
    session: Session, employees: list[Employee], model_id: str
) -> dict[uuid.UUID, str]:
    """For the employees list: like face_states, but an enrolled person the camera struggles
    with shows "reenrol_suggested" (F-41)."""
    states = face_states(session, employees, model_id)
    enrolled = [employee_id for employee_id, state in states.items() if state == "enrolled"]
    for employee_id in reenrol_hints(session, enrolled, model_id, utc_now()):
        states[employee_id] = "reenrol_suggested"
    return states


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
    raise ValueError(f"unknown face state filter: {state}")


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


# The start of a code, up to and including the first "-" or "/": "EMP-0312" -> "EMP-".
_CODE_START = re.compile(r"^[A-Z0-9]*[-/]")
CODE_PREFIX_KEYS = 3


def common_code_prefixes(session: Session, plant_id: uuid.UUID, model_id: str) -> list[str]:
    """The most common starts of the codes of enrolled employees here, for the gate's code pad.

    The pad shows them as one-tap keys (decision 0019). Only starts are sent, never a whole code.
    """
    codes = session.scalars(
        select(Employee.employee_code).where(
            Employee.plant_id == plant_id,
            Employee.status == EmployeeStatus.ACTIVE.value,
            face_state_condition("enrolled", model_id),
        )
    )
    starts = Counter(match.group() for code in codes if (match := _CODE_START.match(code)))
    return [start for start, _ in starts.most_common(CODE_PREFIX_KEYS)]


# --- F-41: "Re-enrol suggested" ----------------------------------------------------------------

HINT_DAYS = 30
RECENT_SCORES = 10
MIN_SCORES_FOR_HINT = 5  # fewer accepted punches say too little about the scores


@dataclass(frozen=True)
class ReenrolHint:
    reason: str  # "code_entries" or "falling_scores"


def reenrol_hints(
    session: Session, employee_ids: list[uuid.UUID], model_id: str, now: datetime
) -> dict[uuid.UUID, ReenrolHint]:
    """Who the camera struggles with, from their punches since their current template (spec
    section 7 rule 15). Only a hint: nothing is blocked. A new enrolment starts the count again."""
    if not employee_ids:
        return {}
    templates = dict(
        session.execute(
            select(FaceTemplate.employee_id, FaceTemplate.enrolled_at).where(
                FaceTemplate.employee_id.in_(employee_ids),
                FaceTemplate.deleted_at.is_(None),
                FaceTemplate.model_id == model_id,
            )
        ).all()
    )
    if not templates:
        return {}
    since = now - timedelta(days=HINT_DAYS)
    code_limit = get_int_setting(session, "face_reenrol_code_count")
    score_floor = get_float_setting(session, "face_match_threshold") + get_float_setting(
        session, "face_reenrol_score_margin"
    )
    hints: dict[uuid.UUID, ReenrolHint] = {}
    for employee_id, enrolled_at in templates.items():
        start = max(since, enrolled_at)
        code_entries = session.scalar(
            select(func.count(Punch.id)).where(
                Punch.claimed_employee_id == employee_id,
                Punch.match_mode == MatchMode.CODE.value,
                Punch.decision == PunchDecision.ACCEPTED.value,
                Punch.server_received_at >= start,
            )
        )
        if (code_entries or 0) >= code_limit:
            hints[employee_id] = ReenrolHint("code_entries")
            continue
        scores = [
            float(score)
            for score in session.scalars(
                select(Punch.match_score)
                .where(
                    Punch.employee_id == employee_id,
                    Punch.match_mode == MatchMode.ONE_TO_MANY.value,
                    Punch.decision == PunchDecision.ACCEPTED.value,
                    Punch.match_score.is_not(None),
                    Punch.server_received_at >= start,
                )
                .order_by(Punch.server_received_at.desc())
                .limit(RECENT_SCORES)
            )
            if score is not None
        ]
        if len(scores) >= MIN_SCORES_FOR_HINT and median(scores) < score_floor:
            hints[employee_id] = ReenrolHint("falling_scores")
    return hints


def reenrol_suggested_ids(
    session: Session, model_id: str, only_plant_ids: frozenset[uuid.UUID] | None
) -> set[uuid.UUID]:
    statement = (
        select(Employee.id)
        .join(FaceTemplate, FaceTemplate.employee_id == Employee.id)
        .where(
            FaceTemplate.deleted_at.is_(None),
            FaceTemplate.model_id == model_id,
            Employee.status == EmployeeStatus.ACTIVE.value,
            Employee.punch_method == PunchMethod.FACE.value,
        )
    )
    if only_plant_ids is not None:
        statement = statement.where(Employee.plant_id.in_(only_plant_ids))
    ids = list(session.scalars(statement))
    return set(reenrol_hints(session, ids, model_id, utc_now()))
