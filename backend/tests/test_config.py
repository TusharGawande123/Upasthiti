"""Settings come from the environment; a missing one stops the app (spec AC-5, AC-6)."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, load_settings_or_exit


def test_missing_database_url_stops_the_app_and_names_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Run from an empty folder so no .env file can supply the value.
    empty_folder = tmp_path / "backend"
    empty_folder.mkdir()
    monkeypatch.chdir(empty_folder)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "Missing required setting: DATABASE_URL" in str(stopped.value)


def test_app_env_defaults_to_production_when_not_set(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fail safe: a server where APP_ENV was forgotten must not show the API docs.
    monkeypatch.delenv("APP_ENV", raising=False)

    settings = Settings(database_url="postgresql://u:p@host/db", _env_file=None)  # pyright: ignore[reportCallIssue]

    assert settings.is_production


def test_invalid_value_is_named_but_not_printed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "my-secret-value")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "APP_ENV" in str(stopped.value)
    assert "my-secret-value" not in str(stopped.value)


@pytest.mark.parametrize(
    ("given_url", "expected_url"),
    [
        ("postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
    ],
)
def test_database_url_always_uses_psycopg_3(given_url: str, expected_url: str) -> None:
    settings = Settings(database_url=given_url)  # pyright: ignore[reportCallIssue]  (secret from env)

    assert settings.database_url == expected_url


def test_short_secret_key_is_refused_without_printing_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_SECRET_KEY", "too-short")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "APP_SECRET_KEY" in str(stopped.value)
    assert "too-short" not in str(stopped.value)


def test_public_origin_is_required_in_production(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Run from an empty folder so no .env file can supply the value.
    empty_folder = tmp_path / "backend"
    empty_folder.mkdir()
    monkeypatch.chdir(empty_folder)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("APP_PUBLIC_ORIGIN", raising=False)

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "Missing required setting: APP_PUBLIC_ORIGIN" in str(stopped.value)


def test_development_falls_back_to_the_vite_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("APP_PUBLIC_ORIGIN", raising=False)

    settings = Settings(database_url="postgresql://u:p@host/db", _env_file=None)  # pyright: ignore[reportCallIssue]

    assert settings.allowed_origin == "http://localhost:5173"


def test_every_response_has_security_headers(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "geolocation=(self)" in response.headers["Permissions-Policy"]


def test_api_docs_are_off_in_production(build_app: Callable[..., FastAPI]) -> None:
    client = TestClient(build_app(APP_ENV="production"))

    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/v1/openapi.json").status_code == 404


def test_api_docs_are_on_in_development(build_app: Callable[..., FastAPI]) -> None:
    client = TestClient(build_app(APP_ENV="development"))

    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/v1/openapi.json").status_code == 200


def test_production_refuses_the_example_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "https://example.invalid")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")
    monkeypatch.setenv("APP_SECRET_KEY", "local-development-only-change-me-0123456789")

    with pytest.raises(ValidationError):
        Settings()  # pyright: ignore[reportCallIssue]
