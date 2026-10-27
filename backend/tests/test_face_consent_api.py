"""Face consent: the text, agreeing, declining, withdrawing (spec M3 AC-3 to AC-5, AC-20, AC-33)."""

import hashlib
import uuid
from datetime import timedelta

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decode_key, seal_vector, template_binding
from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.face import gallery_cache
from app.modules.face.consent_texts import raw_text
from app.modules.face.models import (
    ENROLMENT_POSES,
    FaceConsent,
    FaceEnrolmentSession,
    FaceEnrolmentShot,
    FaceTemplate,
)
from app.modules.settings.models import SettingValue
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import PlantIds, client_for, create_plant, permanent_body

TEXT = "/api/v1/face/consent-texts/face-consent-v1"
CONTACT = "Tushar Gawande, tushar@example.invalid"
ADDRESS = "Plot 1, MIDC Waluj, Chhatrapati Sambhajinagar"
AGREE = {"text_version": "face-consent-v1", "language": "en", "choice": "agreed"}
DECLINE = {"text_version": "face-consent-v1", "language": "en", "choice": "declined"}

# A used consent text is never edited: a change is a new version (spec §7 rule 3, AC-33).
FIXED_HASHES = {
    "en": "3870b07a4ac31f4ef58398e286624580ad02a6d436c9382d3f44b426a1f70e44",
    "mr": "53327bc310c3e617b42d3eaabc02f200c4c92c401a61872044dfcab072952d47",
    "hi": "c0d266c0f750cc6423b7ad834869f96c3bf3bf204537f24f82ebd5243a502149",
}


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def privacy_set(db_session: Session) -> None:
    db_session.merge(SettingValue(key="privacy_contact", value=CONTACT))
    db_session.merge(SettingValue(key="company_address", value=ADDRESS))
    db_session.commit()


@pytest.fixture
def employee(boss: TestClient, k134: PlantIds) -> dict:
    response = boss.post("/api/v1/employees", json=permanent_body(k134))
    assert response.status_code == 201, response.text
    assert response.json()["punch_method"] == "face"
    return response.json()


def consent_url(employee: dict) -> str:
    return f"/api/v1/employees/{employee['id']}/face/consent"


def audit_actions(session: Session, employee: dict) -> list[str]:
    rows = session.scalars(
        select(AuditLog)
        .where(AuditLog.entity_id == uuid.UUID(employee["id"]))
        .order_by(AuditLog.at)
    )
    return [row.action for row in rows]


def head_of(db_app: FastAPI, db_session: Session, plant: PlantIds) -> TestClient:
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "plant.head")
    user = db_session.scalars(select(User).where(User.username == "plant.head")).one()
    set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    return head


# --- The text ---------------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "mr", "hi"])
def test_the_consent_files_never_change(language: str) -> None:
    text = raw_text("face-consent-v1", language)

    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == FIXED_HASHES[language]
    for placeholder in ("{{company_address}}", "{{privacy_contact}}", "{{retention_days}}"):
        assert placeholder in text


def test_the_text_is_shown_with_contact_address_and_retention(
    boss: TestClient, privacy_set: None
) -> None:
    response = boss.get(TEXT, params={"language": "en"})

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "face-consent-v1" and body["language"] == "en"
    assert CONTACT in body["text"] and ADDRESS in body["text"]
    assert "kept for 60 days" in body["text"]
    assert "{{" not in body["text"]
    assert body["text_sha256"] == hashlib.sha256(body["text"].encode()).hexdigest()


@pytest.mark.parametrize("language", ["mr", "hi"])
def test_the_text_exists_in_marathi_and_hindi(
    boss: TestClient, privacy_set: None, language: str
) -> None:
    body = boss.get(TEXT, params={"language": language}).json()

    assert body["language"] == language
    assert CONTACT in body["text"] and "60" in body["text"]


def test_the_text_needs_the_privacy_contact_and_the_company_address(
    boss: TestClient, db_session: Session
) -> None:
    db_session.merge(SettingValue(key="privacy_contact", value=""))
    db_session.commit()
    assert boss.get(TEXT).json()["error"]["code"] == "PRIVACY_CONTACT_MISSING"

    db_session.merge(SettingValue(key="privacy_contact", value=CONTACT))
    db_session.commit()
    assert boss.get(TEXT).json()["error"]["code"] == "COMPANY_ADDRESS_MISSING"


def test_an_unknown_version_or_language_is_refused(boss: TestClient, privacy_set: None) -> None:
    unknown = boss.get("/api/v1/face/consent-texts/face-consent-v9")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "CONSENT_TEXT_UNKNOWN"
    assert boss.get("/api/v1/face/consent-texts/..%2F..%2Fmain").status_code == 404
    assert boss.get(TEXT, params={"language": "fr"}).status_code == 422


def test_a_plant_head_may_read_the_text(
    db_app: FastAPI, db_session: Session, k134: PlantIds, privacy_set: None
) -> None:
    assert head_of(db_app, db_session, k134).get(TEXT).status_code == 200


# --- Agree and decline ------------------------------------------------------------------------


def test_i_agree_saves_the_consent_with_its_text_hash(
    boss: TestClient, db_session: Session, employee: dict, privacy_set: None
) -> None:
    shown = boss.get(TEXT).json()

    response = boss.post(consent_url(employee), json=AGREE)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["punch_method"] == "face"
    assert body["consent"]["choice"] == "agreed"
    assert body["consent"]["recorded_by"]["name"]
    stored = db_session.scalars(select(FaceConsent)).one()
    assert stored.text_sha256 == shown["text_sha256"]
    assert stored.language == "en" and stored.text_version == "face-consent-v1"
    assert audit_actions(db_session, employee) == ["employee.create", "face_consent.give"]


def test_the_explained_language_is_saved(
    boss: TestClient, db_session: Session, employee: dict, privacy_set: None
) -> None:
    body = {**AGREE, "language": "mr", "explained_language": "other"}

    assert boss.post(consent_url(employee), json=body).status_code == 201

    stored = db_session.scalars(select(FaceConsent)).one()
    assert (stored.language, stored.explained_language) == ("mr", "other")


def test_consent_cannot_be_given_twice(boss: TestClient, employee: dict, privacy_set: None) -> None:
    assert boss.post(consent_url(employee), json=AGREE).status_code == 201

    again = boss.post(consent_url(employee), json=AGREE)

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "CONSENT_ALREADY_GIVEN"


def test_no_i_prefer_a_qr_card_switches_the_employee_to_qr(
    boss: TestClient, db_session: Session, employee: dict, privacy_set: None
) -> None:
    response = boss.post(consent_url(employee), json=DECLINE)

    assert response.status_code == 201
    assert response.json()["punch_method"] == "qr"
    assert response.json()["consent"]["choice"] == "declined"
    assert db_session.get(Employee, uuid.UUID(employee["id"])).punch_method == "qr"  # type: ignore[union-attr]
    update = db_session.scalars(select(AuditLog).where(AuditLog.action == "employee.update")).one()
    assert update.reason == "Chose QR card on the consent screen"
    assert "face_consent.decline" in audit_actions(db_session, employee)


def test_consent_needs_privacy_settings_and_an_active_employee(
    boss: TestClient, db_session: Session, employee: dict
) -> None:
    missing = boss.post(consent_url(employee), json=AGREE)
    assert missing.json()["error"]["code"] == "PRIVACY_CONTACT_MISSING"

    db_session.merge(SettingValue(key="privacy_contact", value=CONTACT))
    db_session.merge(SettingValue(key="company_address", value=ADDRESS))
    stored = db_session.get(Employee, uuid.UUID(employee["id"]))
    assert stored is not None
    stored.status = "left"
    stored.left_on = stored.joined_on
    db_session.commit()

    left = boss.post(consent_url(employee), json=AGREE)
    assert left.status_code == 409
    assert left.json()["error"]["code"] == "EMPLOYEE_LEFT"


def test_an_unknown_consent_version_is_refused(
    boss: TestClient, employee: dict, privacy_set: None
) -> None:
    response = boss.post(consent_url(employee), json={**AGREE, "text_version": "face-consent-v2"})

    assert response.json()["error"]["code"] == "CONSENT_TEXT_UNKNOWN"


@pytest.mark.parametrize("role", [Role.CORPORATE_HEAD, Role.PLANT_HEAD])
def test_only_the_super_admin_records_or_withdraws_consent(
    db_app: FastAPI,
    db_session: Session,
    employee: dict,
    privacy_set: None,
    role: Role,
) -> None:
    other = client_for(db_app, db_session, role, "someone")

    for url, body in ((consent_url(employee), AGREE), (consent_url(employee) + "/withdraw", {})):
        response = other.post(url, json=body)
        assert response.status_code == 403, url
        assert response.json()["error"]["code"] == "FORBIDDEN"


def test_an_unknown_employee_is_not_found(boss: TestClient, privacy_set: None) -> None:
    response = boss.post(f"/api/v1/employees/{uuid.uuid4()}/face/consent", json=AGREE)

    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


# --- Withdraw ---------------------------------------------------------------------------------


def _enrol_by_hand(
    db_session: Session, employee: dict
) -> tuple[FaceTemplate, FaceEnrolmentSession]:
    """A stored template and an open enrolment with shots, as slice A's enrolment would leave."""
    consent = db_session.scalars(select(FaceConsent)).one()
    boss_id = consent.recorded_by
    employee_id = uuid.UUID(employee["id"])
    face_key = get_settings().face_template_key
    assert face_key is not None
    key = decode_key(face_key.get_secret_value())
    vector = np.ones(512, dtype=np.float32) / np.sqrt(512)
    sealed = seal_vector(vector, template_binding(employee_id, "fake/fake"), key)
    template = FaceTemplate(
        employee_id=employee_id,
        consent_id=consent.id,
        model_id="fake/fake",
        key_id="A",
        nonce=sealed.nonce,
        ciphertext=sealed.ciphertext,
        shot_count=8,
        enrolled_by=boss_id,
        enrolled_at=utc_now(),
    )
    now = utc_now()
    open_session = FaceEnrolmentSession(
        employee_id=employee_id,
        consent_id=consent.id,
        started_by=boss_id,
        started_at=now,
        expires_at=now + timedelta(minutes=15),
        model_id="fake/fake",
        state="open",
        accepted_shots=2,
        refused_shots=0,
    )
    db_session.add_all([template, open_session])
    db_session.flush()
    for pose in ENROLMENT_POSES[:2]:
        db_session.add(
            FaceEnrolmentShot(
                session_id=open_session.id, pose=pose, nonce=b"n" * 12, ciphertext=b"s" * 2064
            )
        )
    db_session.commit()
    return template, open_session


def test_withdrawing_deletes_the_face_data_and_switches_to_qr(
    boss: TestClient, db_session: Session, employee: dict, k134: PlantIds, privacy_set: None
) -> None:
    boss.post(consent_url(employee), json=AGREE)
    template, open_session = _enrol_by_hand(db_session, employee)
    gallery_cache.remember_gallery(uuid.UUID(k134.id), "cached gallery")

    response = boss.post(consent_url(employee) + "/withdraw", json={"reason": "Employee asked"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {**body, "punch_method": "qr", "template_deleted": True}
    assert body["consent"]["withdraw_kind"] == "withdrawn"
    assert body["consent"]["withdraw_reason"] == "Employee asked"
    db_session.expire_all()
    deleted = db_session.get(FaceTemplate, template.id)
    assert deleted is not None
    assert deleted.ciphertext is None and deleted.nonce is None
    assert deleted.delete_kind == "consent_withdrawn" and deleted.deleted_by is not None
    assert db_session.get(FaceEnrolmentSession, open_session.id).state == "cancelled"  # type: ignore[union-attr]
    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []
    assert db_session.get(Employee, uuid.UUID(employee["id"])).punch_method == "qr"  # type: ignore[union-attr]
    assert uuid.UUID(k134.id) not in gallery_cache.cached_plants()
    actions = audit_actions(db_session, employee)
    for action in (
        "face_consent.withdraw",
        "face_template.delete",
        "face_enrolment.cancel",
        "employee.update",
    ):
        assert action in actions
    # The four audit rows of one withdrawal share one request ID.
    rows = db_session.scalars(
        select(AuditLog).where(AuditLog.action.in_(["face_consent.withdraw", "employee.update"]))
    ).all()
    assert len({row.request_id for row in rows}) == 1


def test_withdrawing_needs_no_reason_and_works_without_a_template(
    boss: TestClient, employee: dict, privacy_set: None
) -> None:
    boss.post(consent_url(employee), json=AGREE)

    response = boss.post(consent_url(employee) + "/withdraw", json={})

    assert response.status_code == 200
    assert response.json()["template_deleted"] is False
    assert response.json()["consent"]["withdraw_reason"] is None


def test_withdrawing_without_an_active_consent_is_refused(
    boss: TestClient, employee: dict, privacy_set: None
) -> None:
    response = boss.post(consent_url(employee) + "/withdraw", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONSENT_NOT_ACTIVE"


def test_after_withdrawing_consent_can_be_given_again(
    boss: TestClient, employee: dict, privacy_set: None
) -> None:
    boss.post(consent_url(employee), json=AGREE)
    boss.post(consent_url(employee) + "/withdraw", json={})

    assert boss.post(consent_url(employee), json=AGREE).status_code == 201
