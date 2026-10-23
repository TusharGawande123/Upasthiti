"""Shared test setup: safe test settings and a helper that builds a fresh app."""

import base64
import os
from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

# Port 1 on localhost refuses connections at once, so no test ever reaches a real database
# by accident, even when DATABASE_URL is set on the machine (as in CI). Set before the app is
# imported.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://test:test@127.0.0.1:1/upasthiti_test"
os.environ["APP_ENV"] = "test"
os.environ["RUN_SCHEDULER"] = "false"
os.environ["DATABASE_URL"] = UNREACHABLE_DATABASE_URL
# Test-only values, not secrets.
os.environ["APP_SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789"
TEST_ORIGIN = "http://testserver"
os.environ["APP_PUBLIC_ORIGIN"] = TEST_ORIGIN
# Test-only keys (32 bytes each, made up for the tests). They let tests that start the app in
# production mode pass the "keys are required in production" check.
os.environ["QR_SIGNING_KEY"] = (
    base64.urlsafe_b64encode(b"test-qr-signing-key-for-pytest-0").decode().rstrip("=")
)
os.environ["SNAPSHOT_ENCRYPTION_KEY"] = (
    base64.urlsafe_b64encode(b"test-snapshot-key-for-pytest-000").decode().rstrip("=")
)
os.environ["FACE_TEMPLATE_KEY"] = (
    base64.urlsafe_b64encode(b"test-face-template-key-pytest-00").decode().rstrip("=")
)
os.environ["STORAGE_BACKEND"] = "local"

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, get_session, get_session_factory  # noqa: E402
from app.core.storage import get_storage  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.auth.rate_limit import (  # noqa: E402
    failed_pairing_limiter,
    login_limiter,
    pairing_limiter,
    punch_limiter,
    report_limiter,
)
from tests.database import create_fresh_test_database, read_test_database_url  # noqa: E402


def clear_cached_settings() -> None:
    get_settings.cache_clear()
    get_storage.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()


@pytest.fixture(autouse=True)
def fresh_settings() -> Iterator[None]:
    """Every test starts and ends with empty settings and engine caches."""
    clear_cached_settings()
    yield
    clear_cached_settings()


@pytest.fixture
def build_app(monkeypatch: pytest.MonkeyPatch) -> Callable[..., FastAPI]:
    """Returns a function that builds the app with some environment variables changed."""

    def _build(**environment: str) -> FastAPI:
        for name, value in environment.items():
            monkeypatch.setenv(name, value)
        clear_cached_settings()
        return create_app()

    return _build


@pytest.fixture
def client(build_app: Callable[..., FastAPI]) -> TestClient:
    return TestClient(build_app(), raise_server_exceptions=False)


# --- Tests that need a real PostgreSQL database -------------------------------------------
# Use the `db_session` fixture (service tests) or `db_client` (API tests). Without
# TEST_DATABASE_URL those tests are skipped locally; CI always sets it, so they always run there.


@pytest.fixture(scope="session")
def migrated_engine() -> Iterator[Engine]:
    url = read_test_database_url()
    if not url:
        pytest.skip(
            "TEST_DATABASE_URL is not set. Start Postgres with `docker compose up -d` and copy "
            "TEST_DATABASE_URL from .env.example into .env."
        )
    engine = create_fresh_test_database(url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(migrated_engine: Engine) -> Iterator[Session]:
    """A session whose changes are all rolled back after the test.

    The test runs inside one outer transaction. "create_savepoint" turns every commit made
    by the code under test into a savepoint, so services can commit normally and the
    database is still clean for the next test.
    """
    connection = migrated_engine.connect()
    outer_transaction = connection.begin()
    session = Session(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    yield session
    session.close()
    outer_transaction.rollback()
    connection.close()


@pytest.fixture
def db_app(build_app: Callable[..., FastAPI], db_session: Session) -> FastAPI:
    app = build_app()

    # Like get_session: a failed request undoes what it had not committed.
    def test_session() -> Iterator[Session]:
        try:
            yield db_session
        except Exception:
            db_session.rollback()
            raise

    app.dependency_overrides[get_session] = test_session
    return app


@pytest.fixture
def db_client(db_app: FastAPI) -> TestClient:
    # Browsers send Origin on every write; the app refuses writes without our own origin.
    return TestClient(db_app, raise_server_exceptions=False, headers={"Origin": TEST_ORIGIN})


@pytest.fixture(autouse=True)
def fresh_rate_limits() -> Iterator[None]:
    """Rate limits are kept in memory; each test starts with empty counters."""
    login_limiter.reset()
    pairing_limiter.reset()
    failed_pairing_limiter.reset()
    punch_limiter.reset()
    report_limiter.reset()
    yield
