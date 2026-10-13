"""Shared test setup: safe test settings and a helper that builds a fresh app."""

import os
from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Port 1 on localhost refuses connections at once, so no test ever reaches a real database
# by accident, even when DATABASE_URL is set on the machine (as in CI). Set before the app is
# imported.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://test:test@127.0.0.1:1/upasthiti_test"
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = UNREACHABLE_DATABASE_URL
# Test-only values, not secrets.
os.environ["APP_SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789"
os.environ["APP_PUBLIC_ORIGIN"] = "http://testserver"

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, get_session_factory  # noqa: E402
from app.main import create_app  # noqa: E402


def clear_cached_settings() -> None:
    get_settings.cache_clear()
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
