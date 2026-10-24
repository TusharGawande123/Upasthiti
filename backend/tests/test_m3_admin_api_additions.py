"""The small API additions of design gate C (decision 0020, spec M3 §5.5): a suggested value for
each setting, the face state in the quick search, and the public privacy notice."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.users.models import Role
from tests.face_helpers import enrol, new_employee, set_privacy
from tests.people_helpers import PlantIds, client_for, create_plant


def test_every_setting_says_whether_it_is_text_and_has_a_report_value_slot(
    db_app: FastAPI, db_session: Session
) -> None:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")

    settings = {row["key"]: row for row in boss.get("/api/v1/settings").json()["settings"]}

    assert settings["company_address"]["is_text"] is True
    assert settings["face_match_threshold"]["is_text"] is False
    # Nothing is suggested until the accuracy report of slice D fills it in.
    assert settings["face_match_threshold"]["report_value"] is None


def test_the_quick_search_gives_the_face_state_of_each_employee(
    db_app: FastAPI, db_session: Session
) -> None:
    set_privacy(db_session)
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant: PlantIds = create_plant(boss, db_session, "K134")
    enrolled = new_employee(boss, plant, code="3001")
    enrol(boss, enrolled, person=3)
    new_employee(boss, plant, code="3002", consent=False)

    found = boss.get("/api/v1/search", params={"q": "300"}).json()["employees"]

    states = {row["employee_code"]: row["face_state"] for row in found}
    assert states == {"3001": "enrolled", "3002": "not_enrolled"}


def test_the_privacy_notice_is_public_and_gives_only_four_values(
    db_app: FastAPI, db_session: Session
) -> None:
    set_privacy(db_session)

    answer = TestClient(db_app).get("/api/v1/privacy-notice")  # no login

    assert answer.status_code == 200
    assert answer.json() == {
        "company_address": "Plot 1, MIDC Waluj",
        "privacy_contact": "Tushar Gawande, t@example.invalid",
        "retention_days": 60,
        "consent_version": "face-consent-v1",
    }


def test_the_privacy_notice_is_empty_until_the_settings_are_made(db_app: FastAPI) -> None:
    answer = TestClient(db_app).get("/api/v1/privacy-notice").json()

    assert answer["company_address"] == "" and answer["privacy_contact"] == ""
