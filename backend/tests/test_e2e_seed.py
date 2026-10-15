"""The E2E seed script refuses to run anywhere it could wipe real data."""

import pytest

from app.scripts import e2e_seed


def test_refuses_outside_test_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:1/upasthiti_e2e")

    assert e2e_seed.main() == 1


def test_refuses_a_database_without_the_e2e_ending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:1/upasthiti")

    assert e2e_seed.main() == 1
