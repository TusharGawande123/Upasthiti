"""The face tables: what the database itself refuses (spec M3 §6, migrations 0011 and 0012).

These talk to a real PostgreSQL. The checks matter because the rules about face data (one
working consent, one working template, data gone when "deleted") must hold even if the code
that uses the tables has a bug.
"""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.face.models import (
    ENROLMENT_POSES,
    FaceConsent,
    FaceEnrolmentSession,
    FaceEnrolmentShot,
    FaceTemplate,
)
from app.modules.settings.models import SettingValue
from app.modules.users.models import Role, User
from app.modules.users.service import create_first_super_admin
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

SHA = "a" * 64
NONCE = b"n" * 12


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def admin_id(boss: TestClient, db_session: Session) -> uuid.UUID:
    return db_session.scalars(select(User.id).where(User.username == "boss")).one()


@pytest.fixture
def employee_id(boss: TestClient, db_session: Session) -> uuid.UUID:
    plant: PlantIds = create_plant(boss, db_session, "K134")
    return uuid.UUID(boss.post("/api/v1/employees", json=permanent_body(plant)).json()["id"])


def make_consent(
    session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID, **changes: object
) -> FaceConsent:
    values: dict[str, object] = {
        "employee_id": employee_id,
        "choice": "agreed",
        "text_version": "face-consent-v1",
        "language": "en",
        "text_sha256": SHA,
        "given_at": utc_now(),
        "recorded_by": admin_id,
    }
    consent = FaceConsent(**{**values, **changes})
    session.add(consent)
    session.flush()
    return consent


def make_template(
    session: Session, consent: FaceConsent, admin_id: uuid.UUID, **changes: object
) -> FaceTemplate:
    values: dict[str, object] = {
        "employee_id": consent.employee_id,
        "consent_id": consent.id,
        "model_id": "buffalo_s/w600k_mbf",
        "key_id": "A",
        "nonce": NONCE,
        "ciphertext": b"c" * 2064,
        "shot_count": 8,
        "enrolled_by": admin_id,
        "enrolled_at": utc_now(),
    }
    template = FaceTemplate(**{**values, **changes})
    session.add(template)
    session.flush()
    return template


def make_session_row(
    session: Session, consent: FaceConsent, admin_id: uuid.UUID, **changes: object
) -> FaceEnrolmentSession:
    now = utc_now()
    values: dict[str, object] = {
        "employee_id": consent.employee_id,
        "consent_id": consent.id,
        "started_by": admin_id,
        "started_at": now,
        "expires_at": now + timedelta(minutes=15),
        "model_id": "buffalo_s/w600k_mbf",
        "state": "open",
        "accepted_shots": 0,
        "refused_shots": 0,
    }
    row = FaceEnrolmentSession(**{**values, **changes})
    session.add(row)
    session.flush()
    return row


def refused(constraint: str):
    return pytest.raises(IntegrityError, match=constraint)


# --- Consents ---------------------------------------------------------------------------------


def test_only_one_working_consent_per_employee(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    first = make_consent(db_session, employee_id, admin_id)

    with refused("uq_face_consents_one_active"), db_session.begin_nested():
        make_consent(db_session, employee_id, admin_id)

    # After a withdrawal a new consent is fine, and a "No" answer never blocks anything.
    first.withdrawn_at = utc_now()
    first.withdrawn_by = admin_id
    first.withdraw_kind = "withdrawn"
    db_session.flush()
    make_consent(db_session, employee_id, admin_id)
    make_consent(db_session, employee_id, admin_id, choice="declined")
    make_consent(db_session, employee_id, admin_id, choice="declined")


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"choice": "maybe"}, "ck_face_consents_choice_known"),
        ({"language": "fr"}, "ck_face_consents_language_known"),
        ({"explained_language": "fr"}, "ck_face_consents_explained_language_known"),
        ({"text_sha256": "not a hash"}, "ck_face_consents_text_hash_format"),
        ({"withdraw_kind": "gone"}, "ck_face_consents_withdraw_kind_known"),
        # Half a withdrawal: the kind without the time, or details without a withdrawal.
        ({"withdraw_kind": "withdrawn"}, "ck_face_consents_withdraw_pair"),
        ({"withdraw_reason": "Employee asked"}, "ck_face_consents_no_withdraw_details"),
    ],
)
def test_consents_refuse_bad_values(
    db_session: Session,
    employee_id: uuid.UUID,
    admin_id: uuid.UUID,
    changes: dict[str, object],
    constraint: str,
) -> None:
    with refused(constraint), db_session.begin_nested():
        make_consent(db_session, employee_id, admin_id, **changes)


def test_a_withdrawal_needs_a_user_unless_the_employee_left(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    by_nobody = {"withdrawn_at": utc_now(), "withdraw_kind": "withdrawn"}
    with refused("ck_face_consents_withdraw_by_user_unless_left"), db_session.begin_nested():
        make_consent(db_session, employee_id, admin_id, **by_nobody)

    # The system closes the consent of someone who left: no user, no reason needed.
    closed = make_consent(
        db_session, employee_id, admin_id, withdrawn_at=utc_now(), withdraw_kind="left"
    )
    assert closed.withdrawn_by is None and closed.withdraw_reason is None


def test_a_declined_answer_cannot_be_withdrawn(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    with refused("ck_face_consents_declined_not_withdrawn"), db_session.begin_nested():
        make_consent(
            db_session,
            employee_id,
            admin_id,
            choice="declined",
            withdrawn_at=utc_now(),
            withdrawn_by=admin_id,
            withdraw_kind="withdrawn",
        )


# --- Templates --------------------------------------------------------------------------------


def test_only_one_working_template_per_employee(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    first = make_template(db_session, consent, admin_id)

    with refused("uq_face_templates_one_active"), db_session.begin_nested():
        make_template(db_session, consent, admin_id)

    # A deleted template keeps its row but holds no face data, so a new one may follow.
    first.deleted_at = utc_now()
    first.delete_kind = "re_enrolled"
    first.nonce = None
    first.ciphertext = None
    db_session.flush()
    make_template(db_session, consent, admin_id)


def test_deleting_a_template_must_remove_the_face_data(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    template = make_template(db_session, consent, admin_id)

    # Marked as deleted but the ciphertext is still there: refused.
    with refused("ck_face_templates_data_until_deleted"), db_session.begin_nested():
        template.deleted_at = utc_now()
        template.delete_kind = "left"
        template.nonce = None
        db_session.flush()

    # Face data removed without saying that it was deleted: refused too.
    with refused("ck_face_templates_data_until_deleted"), db_session.begin_nested():
        template.nonce = None
        template.ciphertext = None
        db_session.flush()


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"key_id": "a"}, "ck_face_templates_key_id_format"),
        ({"shot_count": 7}, "ck_face_templates_shot_count_range"),
        ({"shot_count": 11}, "ck_face_templates_shot_count_range"),
        ({"nonce": b"too short"}, "ck_face_templates_nonce_length"),
        ({"delete_kind": "left"}, "ck_face_templates_delete_pair"),
        ({"delete_reason": "why"}, "ck_face_templates_no_delete_details"),
        ({"duplicate_override_reason": "Twins"}, "ck_face_templates_override_reason_with_person"),
    ],
)
def test_templates_refuse_bad_values(
    db_session: Session,
    employee_id: uuid.UUID,
    admin_id: uuid.UUID,
    changes: dict[str, object],
    constraint: str,
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)

    with refused(constraint), db_session.begin_nested():
        make_template(db_session, consent, admin_id, **changes)


def test_a_deleted_template_needs_a_known_kind(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    gone = {"deleted_at": utc_now(), "nonce": None, "ciphertext": None}

    with refused("ck_face_templates_delete_kind_known"), db_session.begin_nested():
        make_template(db_session, consent, admin_id, delete_kind="forgotten", **gone)
    for kind in ("left", "consent_withdrawn", "re_enrolled", "deleted_by_admin", "method_changed"):
        other = make_consent(db_session, uuid.UUID(str(employee_id)), admin_id, choice="declined")
        make_template(db_session, other, admin_id, delete_kind=kind, **gone)  # system: no user


# --- Enrolment sessions and shots -------------------------------------------------------------


def test_only_one_open_enrolment_session_per_employee(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    first = make_session_row(db_session, consent, admin_id)

    with refused("uq_face_enrolment_sessions_one_open"), db_session.begin_nested():
        make_session_row(db_session, consent, admin_id)

    first.state = "cancelled"
    db_session.flush()
    make_session_row(db_session, consent, admin_id)


@pytest.mark.parametrize(
    ("changes", "constraint"),
    [
        ({"state": "paused"}, "ck_face_enrolment_sessions_state_known"),
        ({"accepted_shots": -1}, "ck_face_enrolment_sessions_shots_not_negative"),
        ({"state": "finished"}, "ck_face_enrolment_sessions_template_only_when_finished"),
    ],
)
def test_sessions_refuse_bad_values(
    db_session: Session,
    employee_id: uuid.UUID,
    admin_id: uuid.UUID,
    changes: dict[str, object],
    constraint: str,
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)

    with refused(constraint), db_session.begin_nested():
        make_session_row(db_session, consent, admin_id, **changes)


def test_a_session_must_end_after_it_starts(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    now = utc_now()

    with refused("ck_face_enrolment_sessions_expires_after_start"), db_session.begin_nested():
        make_session_row(db_session, consent, admin_id, started_at=now, expires_at=now)


def test_a_finished_session_points_to_its_template(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    consent = make_consent(db_session, employee_id, admin_id)
    template = make_template(db_session, consent, admin_id)

    row = make_session_row(
        db_session, consent, admin_id, state="finished", finished_template_id=template.id
    )

    assert row.finished_template_id == template.id


def make_shot(session: Session, row: FaceEnrolmentSession, pose: str, **changes: object) -> None:
    values: dict[str, object] = {
        "session_id": row.id,
        "pose": pose,
        "nonce": NONCE,
        "ciphertext": b"s" * 2064,
    }
    session.add(FaceEnrolmentShot(**{**values, **changes}))
    session.flush()


def test_a_session_has_one_shot_per_pose_and_only_known_poses(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    row = make_session_row(db_session, make_consent(db_session, employee_id, admin_id), admin_id)
    make_shot(db_session, row, "straight")

    with refused("uq_face_enrolment_shots_session_id"), db_session.begin_nested():
        make_shot(db_session, row, "straight")
    with refused("ck_face_enrolment_shots_pose_known"), db_session.begin_nested():
        make_shot(db_session, row, "selfie")
    with refused("ck_face_enrolment_shots_nonce_length"), db_session.begin_nested():
        make_shot(db_session, row, "left", nonce=b"short")
    assert len(ENROLMENT_POSES) == 8


def test_deleting_a_session_removes_its_shots(
    db_session: Session, employee_id: uuid.UUID, admin_id: uuid.UUID
) -> None:
    row = make_session_row(db_session, make_consent(db_session, employee_id, admin_id), admin_id)
    for pose in ENROLMENT_POSES:
        make_shot(db_session, row, pose)

    db_session.execute(text("DELETE FROM face_enrolment_sessions WHERE id = :id"), {"id": row.id})

    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []


# --- Privacy contact --------------------------------------------------------------------------


def test_the_first_super_admin_becomes_the_privacy_contact(db_session: Session) -> None:
    create_first_super_admin(
        db_session,
        name="Tushar Gawande",
        username="tushar",
        email="tushar@example.invalid",
        password="a-long-enough-password",
    )

    stored = db_session.get(SettingValue, "privacy_contact")
    assert stored is not None
    assert stored.value == "Tushar Gawande, tushar@example.invalid"


def test_a_contact_that_was_set_already_is_kept(db_session: Session) -> None:
    db_session.add(SettingValue(key="privacy_contact", value="Plant office, Sheet Shapers"))
    db_session.flush()

    create_first_super_admin(
        db_session,
        name="Tushar Gawande",
        username="tushar",
        email=None,
        password="a-long-enough-password",
    )

    assert db_session.get(SettingValue, "privacy_contact").value == "Plant office, Sheet Shapers"  # type: ignore[union-attr]
