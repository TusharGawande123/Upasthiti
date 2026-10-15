"""Login, lockout, sessions and the Origin check (spec AC-2, AC-4, AC-5, AC-42)."""

from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.auth.models import LoginSession
from app.modules.users.models import Role
from tests.conftest import TEST_ORIGIN
from tests.factories import TEST_PASSWORD, log_in, make_user

LOGIN = "/api/v1/auth/login"
ME = "/api/v1/auth/me"


def login_response(client: TestClient, login: str, password: str = TEST_PASSWORD):
    return client.post(LOGIN, json={"login": login, "password": password})


def test_login_with_username_sets_a_safe_cookie(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")

    response = login_response(db_client, "sachin.k")

    assert response.status_code == 200
    assert response.json()["role"] == "super_admin"
    cookie_header = response.headers["set-cookie"].lower()
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    assert db_client.get(ME).json()["username"] == "sachin.k"


def test_login_with_email_in_any_case(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k", email="s@example.com")

    assert login_response(db_client, "S@Example.com").status_code == 200


def test_wrong_password_and_unknown_user_get_the_same_answer(
    db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, username="sachin.k")

    wrong_password = login_response(db_client, "sachin.k", "Not-The-Password")
    unknown_user = login_response(db_client, "nobody")

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert unknown_user.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_failed_login_is_audited_without_the_password(
    db_client: TestClient, db_session: Session
) -> None:
    login_response(db_client, "nobody", "Typed-Secret-99")

    entry = db_session.scalars(select(AuditLog).where(AuditLog.action == "auth.login_failed")).one()
    assert entry.after == {"login": "nobody", "account_locked": False}
    assert "Typed-Secret-99" not in str(entry.before) + str(entry.after)


def test_fifth_wrong_password_locks_the_account(db_client: TestClient, db_session: Session) -> None:
    user = make_user(db_session, username="sachin.k")

    answers = [login_response(db_client, "sachin.k", "Wrong-Password-1") for _ in range(5)]
    with_right_password = login_response(db_client, "sachin.k")

    assert [answer.status_code for answer in answers[:4]] == [401] * 4
    assert answers[4].json()["error"]["code"] == "ACCOUNT_LOCKED"
    assert with_right_password.json()["error"]["code"] == "ACCOUNT_LOCKED"
    assert with_right_password.json()["error"]["details"]["minutes_left"] >= 14

    # After the lock time has passed the right password works again.
    user.locked_until = utc_now() - timedelta(seconds=1)
    db_session.commit()
    assert login_response(db_client, "sachin.k").status_code == 200


def test_switched_off_account_cannot_log_in(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="old.head", is_active=False)

    response = login_response(db_client, "old.head")

    assert response.json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_me_without_login_is_not_authenticated(db_client: TestClient) -> None:
    response = db_client.get(ME)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_session_ends_after_60_idle_minutes(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")
    log_in(db_client, "sachin.k")

    login_session = db_session.scalars(select(LoginSession)).one()
    login_session.last_seen_at = utc_now() - timedelta(minutes=61)
    db_session.commit()

    assert db_client.get(ME).status_code == 401


def test_session_ends_after_12_hours(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")
    log_in(db_client, "sachin.k")

    login_session = db_session.scalars(select(LoginSession)).one()
    login_session.expires_at = utc_now() - timedelta(seconds=1)
    db_session.commit()

    assert db_client.get(ME).status_code == 401


def test_logout_ends_the_session(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")
    log_in(db_client, "sachin.k")

    assert db_client.post("/api/v1/auth/logout").status_code == 204
    assert db_client.get(ME).status_code == 401


def test_password_change_ends_other_sessions(
    db_app: FastAPI, db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, username="sachin.k")
    other_browser = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(db_client, "sachin.k")
    log_in(other_browser, "sachin.k")

    response = db_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": TEST_PASSWORD, "new_password": "A-Brand-New-Secret-7"},
    )

    assert response.status_code == 204
    assert db_client.get(ME).status_code == 200
    assert other_browser.get(ME).status_code == 401


def test_weak_new_password_is_refused(db_client: TestClient, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")
    log_in(db_client, "sachin.k")

    response = db_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": TEST_PASSWORD, "new_password": "short"},
    )

    assert response.json()["error"]["code"] == "PASSWORD_TOO_WEAK"
    assert response.json()["error"]["details"]["rule"] == "min_length"


def test_temporary_password_must_be_changed_first(
    db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, username="new.head", must_change_password=True)
    log_in(db_client, "new.head")

    assert db_client.get(ME).json()["must_change_password"] is True
    blocked = db_client.get("/api/v1/auth/sessions")
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"


def test_write_from_another_site_is_refused(db_app: FastAPI, db_session: Session) -> None:
    make_user(db_session, username="sachin.k")
    foreign = TestClient(db_app, headers={"Origin": "https://evil.example"})
    no_origin = TestClient(db_app)
    with_referer = TestClient(db_app, headers={"Referer": f"{TEST_ORIGIN}/admin/login"})

    for client in (foreign, no_origin):
        response = login_response(client, "sachin.k")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"
    assert login_response(with_referer, "sachin.k").status_code == 200


def test_too_many_login_attempts_from_one_address(db_client: TestClient) -> None:
    answers = [login_response(db_client, f"nobody{number}") for number in range(21)]

    assert answers[19].status_code == 401
    assert answers[20].json()["error"]["code"] == "TOO_MANY_REQUESTS"


def test_user_sees_and_ends_own_sessions(
    db_app: FastAPI, db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    other_browser = TestClient(db_app, headers={"Origin": TEST_ORIGIN})
    log_in(db_client, "corp.head")
    log_in(other_browser, "corp.head")

    sessions = db_client.get("/api/v1/auth/sessions").json()
    assert len(sessions) == 2
    other = next(item for item in sessions if not item["is_current"])

    assert db_client.delete(f"/api/v1/auth/sessions/{other['id']}").status_code == 204
    assert other_browser.get(ME).status_code == 401
    assert db_client.get(ME).status_code == 200
