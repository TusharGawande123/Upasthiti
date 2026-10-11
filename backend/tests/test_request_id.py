"""Request IDs and JSON log lines (spec AC-23)."""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter, choose_request_id, current_request_id


def test_a_new_request_id_is_sent_back(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert len(response.headers["X-Request-ID"]) == 32


def test_a_safe_incoming_request_id_is_kept(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Request-ID": "kiosk-7.abc_1"})

    assert response.headers["X-Request-ID"] == "kiosk-7.abc_1"


@pytest.mark.parametrize("unsafe_id", ["has space", "line\nbreak", "x" * 65, ""])
def test_an_unsafe_incoming_request_id_is_replaced(unsafe_id: str) -> None:
    assert choose_request_id(unsafe_id) != unsafe_id


def test_log_lines_are_json_with_the_request_id(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = client.get("/api/v1/health", headers={"X-Request-ID": "trace-me"})

    finished = [record for record in caplog.records if record.getMessage() == "request finished"]
    assert finished, "the middleware should log one line per request"

    token = current_request_id.set("trace-me")
    try:
        line = json.loads(JsonFormatter().format(finished[-1]))
    finally:
        current_request_id.reset(token)
    assert line["request_id"] == response.headers["X-Request-ID"]
    assert line["status"] == 200
    assert line["path"] == "/api/v1/health"
