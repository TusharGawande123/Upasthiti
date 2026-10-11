"""Health endpoints (spec AC-2, AC-3)."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.modules.health import router as health_router


def test_health_returns_status_version_and_utc_time(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == "dev"
    server_time = datetime.fromisoformat(body["server_time"])
    assert server_time.utcoffset() is not None
    assert server_time.utcoffset().total_seconds() == 0  # pyright: ignore[reportOptionalMemberAccess]


def test_health_does_not_touch_the_database(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_if_called() -> None:
        raise AssertionError("/health must not use the database")

    monkeypatch.setattr(health_router, "check_database_connection", fail_if_called)

    assert client.get("/api/v1/health").status_code == 200


def test_ready_is_ok_when_database_answers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health_router, "check_database_connection", lambda: None)

    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_ready_reports_database_unavailable_without_leaking_details(client: TestClient) -> None:
    # The test DATABASE_URL points at a closed port, so the real check fails.
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert "127.0.0.1" not in response.text
    assert "test" not in response.json()["error"]["message"].lower()
