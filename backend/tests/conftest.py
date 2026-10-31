"""Shared test setup: safe test settings and a helper that builds a fresh app."""

import base64
import hashlib
import os
from collections.abc import Callable, Iterator
from contextlib import nullcontext

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
# The fake face engine reads painted test pictures; no model files are needed (spec M3 §11).
os.environ["FACE_ENGINE"] = "fake"
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
# M4: a P-256 key made from a fixed phrase (the hash is the secret number), never a stored key.
os.environ["OFFLINE_EVIDENCE_KEY"] = (
    base64.urlsafe_b64encode(
        bytes.fromhex("3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420")
        + hashlib.sha256(b"upasthiti pytest: offline evidence").digest()
    )
    .decode()
    .rstrip("=")
)
os.environ["STORAGE_BACKEND"] = "local"

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, get_session, get_session_factory  # noqa: E402
from app.core.storage import get_storage  # noqa: E402
from app.face.engine import FaceEngine  # noqa: E402
from app.face.fake_engine import FakeFaceModels  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.auth.rate_limit import (  # noqa: E402
    challenge_limiter,
    code_try_limiter,
    enrolment_shot_limiter,
    failed_pairing_limiter,
    login_limiter,
    pairing_limiter,
    punch_limiter,
    report_limiter,
)
from app.modules.face.engine_provider import get_face_engine  # noqa: E402
from app.modules.face.gallery_cache import clear_all_galleries  # noqa: E402
from app.modules.punches.photo_check import get_task_sessions  # noqa: E402
from tests.database import create_fresh_test_database, read_test_database_url  # noqa: E402


def clear_cached_settings() -> None:
    get_settings.cache_clear()
    get_storage.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    get_face_engine.cache_clear()


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
def face_engine() -> FaceEngine:
    """A ready fake face engine (no model files); tests may replace it on the app."""
    engine = FaceEngine(FakeFaceModels)
    engine.load_now()
    return engine


@pytest.fixture(autouse=True)
def fresh_face_galleries() -> Iterator[None]:
    clear_all_galleries()
    yield
    clear_all_galleries()


@pytest.fixture
def db_app(
    build_app: Callable[..., FastAPI], db_session: Session, face_engine: FaceEngine
) -> FastAPI:
    app = build_app()
    app.dependency_overrides[get_face_engine] = lambda: face_engine
    # Background tasks (F-30) use the test's session, so they see its uncommitted data.
    app.dependency_overrides[get_task_sessions] = lambda: lambda: nullcontext(db_session)

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
    enrolment_shot_limiter.reset()
    challenge_limiter.reset()
    code_try_limiter.reset()
    yield


@pytest.fixture
def early_out_alert_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the early-OUT alert off (M5 decision 0036 line 9) for a test about something else.

    Without it, an OUT before the end of the plant's default shift 07:00-19:00 answers "needs
    confirmation" at most times of the day, which has nothing to do with what such a test checks.
    The alert has its own tests (test_m5_early_out.py), which do not use this fixture.
    """
    for module in (
        "app.modules.punches.service",
        "app.modules.punches.face_service",
        "app.modules.punches.early_out",
    ):
        monkeypatch.setattr(f"{module}.early_out_info", lambda *args, **kwargs: None)
