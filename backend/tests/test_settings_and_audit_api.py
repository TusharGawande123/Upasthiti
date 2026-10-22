"""Settings screen API and the audit viewer (spec AC-12, AC-25)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.users.models import Role
from tests.factories import log_in, make_user

SETTINGS = "/api/v1/settings"
AUDIT = "/api/v1/audit"


def settings_by_key(client: TestClient) -> dict[str, dict]:
    return {item["key"]: item for item in client.get(SETTINGS).json()["settings"]}


def test_super_admin_changes_a_setting_and_it_is_audited(
    db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")

    response = db_client.put(
        SETTINGS,
        json={"values": {"gps_accuracy_limit_m": 30}, "reason": "Gate phones are accurate"},
    )

    assert response.status_code == 200
    assert settings_by_key(db_client)["gps_accuracy_limit_m"]["value"] == 30
    entry = db_client.get(AUDIT, params={"action": "settings.update"}).json()["items"][0]
    assert entry["before"] == {"value": 50}
    assert entry["after"] == {"value": 30}
    assert entry["reason"] == "Gate phones are accurate"
    assert entry["actor_name"] == "Test super_admin"


def test_values_outside_the_range_are_refused(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")

    too_small = db_client.put(
        SETTINGS, json={"values": {"gps_accuracy_limit_m": 5}, "reason": "try"}
    )
    not_yet = db_client.put(
        SETTINGS, json={"values": {"face_match_threshold": 0.5}, "reason": "try"}
    )
    unknown = db_client.put(SETTINGS, json={"values": {"colour": "blue"}, "reason": "try"})

    assert too_small.json()["error"]["code"] == "SETTING_OUT_OF_RANGE"
    assert not_yet.json()["error"]["code"] == "SETTING_NOT_EDITABLE_YET"
    assert unknown.json()["error"]["code"] == "SETTING_UNKNOWN"


def test_defaults_and_later_settings_are_listed(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.PLANT_HEAD, username="plant.head")
    log_in(db_client, "plant.head")

    settings = settings_by_key(db_client)

    assert settings["session_idle_minutes"]["value"] == 60
    assert settings["face_match_threshold"]["editable"] is False
    assert settings["salary_day_basis"]["allowed_values"] == [26, 30, "actual"]


def test_only_the_super_admin_changes_settings(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    log_in(db_client, "corp.head")

    response = db_client.put(
        SETTINGS, json={"values": {"gps_accuracy_limit_m": 30}, "reason": "try"}
    )

    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_plant_head_does_not_see_company_wide_audit_entries(
    db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.PLANT_HEAD, username="plant.head")
    log_in(db_client, "plant.head")  # writes a company-wide auth.login entry

    page = db_client.get(AUDIT).json()

    assert page["total"] == 0


def test_audit_filters_by_action(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    db_client.post("/api/v1/auth/login", json={"login": "nobody", "password": "x"})

    failed = db_client.get(AUDIT, params={"action": "auth.login_failed"}).json()

    assert failed["total"] == 1
    assert failed["items"][0]["after"]["login"] == "nobody"
