"""Request IDs and JSON log lines (spec AC-23)."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter, RequestIdFilter, choose_request_id


def test_a_new_request_id_is_sent_back(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert len(response.headers["X-Request-ID"]) == 32


def test_a_safe_incoming_request_id_is_kept(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Request-ID": "kiosk-7.abc_1"})

    assert response.headers["X-Request-ID"] == "kiosk-7.abc_1"


@pytest.mark.parametrize("unsafe_id", ["has space", "line\nbreak", "trailing\n", "x" * 65, ""])
def test_an_unsafe_incoming_request_id_is_replaced(unsafe_id: str) -> None:
    assert choose_request_id(unsafe_id) != unsafe_id


def test_log_lines_are_json_with_the_request_id(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    # Use the same filter and formatter as the real app, so the line is built during the
    # request exactly as on the server.
    caplog.handler.addFilter(RequestIdFilter())
    caplog.handler.setFormatter(JsonFormatter())

    with caplog.at_level(logging.INFO, logger="app.request"):
        response = client.get("/api/v1/health", headers={"X-Request-ID": "trace-me"})

    lines = [json.loads(text) for text in caplog.text.splitlines()]
    finished = [line for line in lines if line["message"] == "request finished"]
    assert finished, "the middleware should log one line per request"
    assert finished[-1]["request_id"] == response.headers["X-Request-ID"] == "trace-me"
    assert finished[-1]["status"] == 200
    assert finished[-1]["path"] == "/api/v1/health"


def test_api_answers_are_never_cached(client) -> None:  # noqa: ANN001 (pytest fixture)
    assert client.get("/api/v1/health").headers["Cache-Control"] == "no-store"
