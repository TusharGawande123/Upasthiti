"""M6 AC-M6-12: the session cases the older tests do not cover.

Already tested elsewhere: 60 idle minutes and 12 hours end a session (test_auth_api.py), logout,
password change, force logout and switching an account off (test_auth_api.py, test_users_api.py).
Here: a new session id at every login (no session fixation), an old cookie is dead after logout,
a made-up cookie is refused, and the database never holds the cookie value itself.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.dependencies import SESSION_COOKIE_NAME
from app.modules.auth.models import LoginSession
from tests.conftest import TEST_ORIGIN
from tests.factories import TEST_PASSWORD, make_user

LOGIN = "/api/v1/auth/login"
ME = "/api/v1/auth/me"


def browser(app: FastAPI) -> TestClient:
    return TestClient(app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})


def sign_in(client: TestClient, login: str) -> str:
    answer = client.post(LOGIN, json={"login": login, "password": TEST_PASSWORD})
    assert answer.status_code == 200, answer.text
    token = client.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return token


def test_every_login_gets_a_new_session_id_and_ignores_a_cookie_sent_with_it(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-12: an attacker who plants a cookie value cannot make it the session."""
    make_user(db_session, username="sachin.k")
    planted = "attacker-chosen-session-value"
    victim = browser(db_app)
    answer = victim.post(
        LOGIN,
        json={"login": "sachin.k", "password": TEST_PASSWORD},
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={planted}"},
    )
    assert answer.status_code == 200, answer.text
    first = answer.cookies.get(SESSION_COOKIE_NAME)
    assert first
    second = sign_in(browser(db_app), "sachin.k")

    assert first != planted
    assert second != first
    stranger = browser(db_app)
    stranger.cookies.set(SESSION_COOKIE_NAME, planted)
    assert stranger.get(ME).status_code == 401


def test_a_cookie_copied_before_logout_is_dead_after_logout(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-12: logout ends the session on the server, not only in the browser."""
    make_user(db_session, username="sachin.k")
    client = browser(db_app)
    token = sign_in(client, "sachin.k")
    assert client.post("/api/v1/auth/logout").status_code in (200, 204)

    replay = browser(db_app)
    replay.cookies.set(SESSION_COOKIE_NAME, token)

    assert replay.get(ME).status_code == 401


def test_made_up_and_malformed_cookies_are_refused_without_a_server_error(
    db_app: FastAPI,
) -> None:
    """M6 AC-M6-12: empty, very long, quoted and non-ASCII-looking cookie values answer 401."""
    for value in ("", "x", "A" * 4000, '"quoted"', "a;b", "%00", "0" * 64):
        client = browser(db_app)
        client.cookies.set(SESSION_COOKIE_NAME, value)
        assert client.get(ME).status_code == 401, value[:10]


def test_the_database_holds_only_a_hash_of_the_session_cookie(
    db_app: FastAPI, db_session: Session
) -> None:
    """M6 AC-M6-12: whoever reads the table cannot sign in with what he finds."""
    make_user(db_session, username="sachin.k")
    token = sign_in(browser(db_app), "sachin.k")

    stored = [row.token_hash for row in db_session.scalars(select(LoginSession))]

    assert stored
    assert token not in stored
    assert all(token not in value for value in stored)
