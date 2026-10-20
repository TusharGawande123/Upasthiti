"""Settings come from the environment; a missing one stops the app (spec AC-5, AC-6)."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, load_settings_or_exit
from app.core.crypto import generate_key_text


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


# --- M2: keys and storage are required in production (spec AC-27) ---------------------------

# Made fresh for every test run, so no key-looking text is stored in the repository (the secret
# scanner would rightly flag it).
PRODUCTION_KEY = generate_key_text()
SECOND_KEY = generate_key_text()
SERVICE_KEY_VALUE = "service-key-value-that-must-never-be-printed"


@pytest.fixture
def production_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> pytest.MonkeyPatch:
    """A complete, valid production environment; each test removes one setting."""
    # Run from an empty folder so no .env file can supply a value.
    empty_folder = tmp_path / "backend"
    empty_folder.mkdir()
    monkeypatch.chdir(empty_folder)
    values = {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql://u:p@host/db",
        "APP_SECRET_KEY": "production-secret-key-0123456789abcdef",
        "APP_PUBLIC_ORIGIN": "https://example.invalid",
        "QR_SIGNING_KEY": PRODUCTION_KEY,
        "SNAPSHOT_ENCRYPTION_KEY": SECOND_KEY,
        "STORAGE_BACKEND": "supabase",
        "SUPABASE_URL": "https://project.supabase.invalid",
        "SUPABASE_SERVICE_KEY": SERVICE_KEY_VALUE,
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def test_a_complete_production_environment_loads(
    production_environment: pytest.MonkeyPatch,
) -> None:
    settings = load_settings_or_exit()

    assert settings.effective_storage_backend == "supabase"
    assert settings.snapshot_bucket == "punch-snapshots"
    assert settings.qr_signing_key_id == "A"


@pytest.mark.parametrize(
    "missing",
    [
        "QR_SIGNING_KEY",
        "SNAPSHOT_ENCRYPTION_KEY",
        "STORAGE_BACKEND",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
    ],
)
def test_production_stops_when_a_card_or_storage_setting_is_missing(
    production_environment: pytest.MonkeyPatch, missing: str
) -> None:
    production_environment.delenv(missing)

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    message = str(stopped.value)
    assert f"Missing required setting: {missing}" in message
    for secret in (PRODUCTION_KEY, SECOND_KEY, SERVICE_KEY_VALUE):
        assert secret not in message


def test_a_blank_key_counts_as_not_set(production_environment: pytest.MonkeyPatch) -> None:
    production_environment.setenv("QR_SIGNING_KEY", "   ")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "Missing required setting: QR_SIGNING_KEY" in str(stopped.value)


def test_local_storage_needs_no_supabase_settings_in_production(
    production_environment: pytest.MonkeyPatch,
) -> None:
    # The client's own server may keep snapshots on a real disk (decision 0004).
    production_environment.setenv("STORAGE_BACKEND", "local")
    production_environment.delenv("SUPABASE_URL")
    production_environment.delenv("SUPABASE_SERVICE_KEY")

    assert load_settings_or_exit().effective_storage_backend == "local"


@pytest.mark.parametrize("variable", ["QR_SIGNING_KEY", "SNAPSHOT_ENCRYPTION_KEY"])
def test_a_key_that_is_not_32_bytes_is_named_but_not_printed(
    production_environment: pytest.MonkeyPatch, variable: str
) -> None:
    production_environment.setenv(variable, "too-short-to-be-a-key")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert f"Invalid value for setting: {variable}" in str(stopped.value)
    assert "too-short-to-be-a-key" not in str(stopped.value)


def test_the_key_id_must_be_one_capital_letter(
    production_environment: pytest.MonkeyPatch,
) -> None:
    production_environment.setenv("QR_SIGNING_KEY_ID", "a1")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "Invalid value for setting: QR_SIGNING_KEY_ID" in str(stopped.value)


def test_an_unknown_storage_backend_is_refused(
    production_environment: pytest.MonkeyPatch,
) -> None:
    production_environment.setenv("STORAGE_BACKEND", "dropbox")

    with pytest.raises(SystemExit) as stopped:
        load_settings_or_exit()

    assert "Invalid value for setting: STORAGE_BACKEND" in str(stopped.value)


def test_development_needs_none_of_the_card_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("QR_SIGNING_KEY", "SNAPSHOT_ENCRYPTION_KEY", "STORAGE_BACKEND"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(
        database_url="postgresql://u:p@host/db",
        app_env="development",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )

    assert settings.qr_signing_key is None
    assert settings.effective_storage_backend == "local"
    assert settings.storage_local_dir.name == ".storage"


def test_secret_keys_are_hidden_when_the_settings_are_printed(
    production_environment: pytest.MonkeyPatch,
) -> None:
    text = repr(load_settings_or_exit())

    for secret in (PRODUCTION_KEY, SECOND_KEY, SERVICE_KEY_VALUE):
        assert secret not in text
