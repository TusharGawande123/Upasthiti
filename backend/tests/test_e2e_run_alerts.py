"""The end-to-end alert runner refuses to run anywhere except the local throw-away database."""

import pytest

from app.scripts import e2e_run_alerts


def test_refuses_outside_test_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:1/upasthiti_e2e")

    with pytest.raises(SystemExit, match="APP_ENV=test"):
        e2e_run_alerts.main()


def test_refuses_a_database_without_the_e2e_ending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:1/upasthiti")

    with pytest.raises(SystemExit, match="_e2e"):
        e2e_run_alerts.main()


def test_refuses_a_database_on_another_computer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@db.example.com:5432/upasthiti_e2e")

    with pytest.raises(SystemExit, match="on this computer"):
        e2e_run_alerts.main()
