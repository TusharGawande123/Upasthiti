"""In production the API docs are only for a logged-in Super Admin (spec AC-29)."""

from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.users.models import Role
from tests.factories import log_in, make_user

HTTPS_ORIGIN = "https://testserver"


@pytest.fixture
def production_client(build_app: Callable[..., FastAPI], db_session: Session) -> TestClient:
    app = build_app(APP_ENV="production", APP_PUBLIC_ORIGIN=HTTPS_ORIGIN)
    app.dependency_overrides[get_session] = lambda: db_session
    # Production cookies are HTTPS-only, so the test client must use https too.
    return TestClient(app, base_url=HTTPS_ORIGIN, headers={"Origin": HTTPS_ORIGIN})


def test_docs_are_hidden_from_logged_out_visitors(production_client: TestClient) -> None:
    assert production_client.get("/api/docs").status_code == 404
    assert production_client.get("/api/v1/openapi.json").status_code == 404


def test_docs_are_hidden_from_other_roles(
    production_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.CORPORATE_HEAD, username="corp.head")
    log_in(production_client, "corp.head")

    assert production_client.get("/api/docs").status_code == 404


def test_super_admin_sees_the_docs_in_production(
    production_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(production_client, "boss")

    assert production_client.get("/api/docs").status_code == 200
    assert production_client.get("/api/v1/openapi.json").json()["info"]["title"] == "Upasthiti API"
