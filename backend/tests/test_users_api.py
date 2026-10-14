"""Admin user management by the Super Admin (spec §5.1, AC-1, AC-3, AC-42)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.models import AuditLog
from app.modules.users.models import Role, User
from app.modules.users.service import create_first_super_admin
from tests.conftest import TEST_ORIGIN
from tests.factories import log_in, make_user

USERS = "/api/v1/users"


@pytest.fixture
def super_admin_client(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


def test_super_admin_creates_a_corporate_head_with_a_temporary_password(
    super_admin_client: TestClient, db_app: FastAPI, db_session: Session
) -> None:
    response = super_admin_client.post(
        USERS,
        json={"name": "Asha Rao", "username": "Asha.Rao", "role": "corporate_head"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["username"] == "asha.rao"
    assert body["user"]["must_change_password"] is True
    temporary_password = body["temporary_password"]

    # The temporary password works once, then the user must set their own.
    new_user = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(new_user, "asha.rao", temporary_password)
    assert new_user.get("/api/v1/auth/sessions").status_code == 403

    entry = db_session.scalars(select(AuditLog).where(AuditLog.action == "user.create")).one()
    assert temporary_password not in str(entry.after)


def test_plant_head_needs_a_plant(super_admin_client: TestClient) -> None:
    response = super_admin_client.post(
        USERS, json={"name": "P Head", "username": "p.head", "role": "plant_head"}
    )

    assert response.json()["error"]["code"] == "PLANT_REQUIRED_FOR_ROLE"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"username": "boss"}, "USERNAME_EXISTS"),
        ({"username": "no spaces"}, "USERNAME_INVALID"),
        ({"username": "ok.name", "email": "not-an-email"}, "EMAIL_INVALID"),
    ],
)
def test_bad_user_details_are_refused(
    super_admin_client: TestClient, payload: dict[str, str], code: str
) -> None:
    response = super_admin_client.post(
        USERS, json={"name": "Someone", "role": "corporate_head", **payload}
    )

    assert response.json()["error"]["code"] == code


def test_other_roles_cannot_manage_users(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    log_in(db_client, "corp.head")

    assert db_client.get(USERS).json()["error"]["code"] == "FORBIDDEN"
    assert db_client.post(USERS, json={}).status_code in (403, 422)


def test_last_super_admin_cannot_be_demoted_or_switched_off(
    super_admin_client: TestClient, db_session: Session
) -> None:
    boss = db_session.scalars(select(User).where(User.username == "boss")).one()

    demote = super_admin_client.patch(f"{USERS}/{boss.id}", json={"role": "corporate_head"})
    switch_off = super_admin_client.post(
        f"{USERS}/{boss.id}/deactivate", json={"reason": "testing"}
    )

    assert demote.json()["error"]["code"] == "LAST_SUPER_ADMIN"
    assert switch_off.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"


def test_deactivating_a_user_ends_their_sessions(
    super_admin_client: TestClient, db_app: FastAPI, db_session: Session
) -> None:
    head = make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    head_browser = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(head_browser, "corp.head")

    response = super_admin_client.post(
        f"{USERS}/{head.id}/deactivate", json={"reason": "Left the company"}
    )

    assert response.json()["is_active"] is False
    assert head_browser.get("/api/v1/auth/me").status_code == 401


def test_reset_password_and_force_logout(
    super_admin_client: TestClient, db_app: FastAPI, db_session: Session
) -> None:
    head = make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    head_browser = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(head_browser, "corp.head")

    forced = super_admin_client.post(
        f"{USERS}/{head.id}/force-logout", json={"reason": "Laptop lost"}
    )
    assert forced.status_code == 204
    assert head_browser.get("/api/v1/auth/me").status_code == 401

    reset = super_admin_client.post(
        f"{USERS}/{head.id}/reset-password", json={"reason": "Forgot password"}
    )
    log_in(head_browser, "corp.head", reset.json()["temporary_password"])
    assert head_browser.get("/api/v1/auth/me").json()["must_change_password"] is True


def test_list_users_with_search(super_admin_client: TestClient, db_session: Session) -> None:
    make_user(db_session, Role.CORPORATE_HEAD, username="asha.rao")

    page = super_admin_client.get(USERS, params={"q": "asha"}).json()

    assert page["total"] == 1
    assert page["items"][0]["username"] == "asha.rao"


def test_first_super_admin_is_created_only_once(db_session: Session) -> None:
    user = create_first_super_admin(
        db_session, name="Tushar", username="tushar", email=None, password="Gate-Kiosk-2026!"
    )
    assert user.role == "super_admin"

    with pytest.raises(ApiError) as refused:
        create_first_super_admin(
            db_session, name="Other", username="other", email=None, password="Gate-Kiosk-2026!"
        )
    assert refused.value.code == "SUPER_ADMIN_EXISTS"


@pytest.mark.parametrize(
    ("text", "ok"),
    [
        ("asha@example.com", True),
        ("a.b@plant.co.in", True),
        ("no-at-sign.com", False),
        ("two@@example.com", False),
        ("space @example.com", False),
        ("asha@localhost", False),
        ("asha@.com", False),
        # The old regular expression was very slow on this text; now it is answered at once.
        ("!@!." + "!." * 5000, True),
    ],
    ids=["plain", "subdomain", "no-at", "two-at", "space", "no-dot", "dot-start", "long"],
)
def test_email_check(text: str, ok: bool) -> None:
    from app.modules.users.service import _looks_like_email  # pyright: ignore[reportPrivateUsage]

    assert _looks_like_email(text) is ok
