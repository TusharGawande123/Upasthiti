"""Every error uses the standard format (spec AC-4)."""

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.errors import ApiError


class SampleBody(BaseModel):
    employee_code: int


def build_app_with_test_routes(build_app: Callable[..., FastAPI]) -> TestClient:
    app = build_app()

    @app.post("/test/validate")
    def validate(body: SampleBody) -> dict[str, int]:
        return {"employee_code": body.employee_code}

    @app.get("/test/crash")
    def crash() -> None:
        raise RuntimeError("secret internal detail")

    @app.get("/test/api-error")
    def api_error() -> None:
        raise ApiError("QR_REVOKED", "This card is revoked.", 409, {"card": "A1"})

    return TestClient(app, raise_server_exceptions=False)


def assert_standard_error(body: dict, expected_code: str) -> None:
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == expected_code


def test_unknown_path_returns_not_found(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert_standard_error(response.json(), "NOT_FOUND")


def test_wrong_method_returns_method_not_allowed(client: TestClient) -> None:
    response = client.post("/api/v1/health")

    assert response.status_code == 405
    assert_standard_error(response.json(), "METHOD_NOT_ALLOWED")


def test_bad_body_lists_fields_without_echoing_values(build_app: Callable[..., FastAPI]) -> None:
    client = build_app_with_test_routes(build_app)

    response = client.post("/test/validate", json={"employee_code": "my-password-123"})

    assert response.status_code == 422
    assert_standard_error(response.json(), "VALIDATION_FAILED")
    fields = response.json()["error"]["details"]["fields"]
    assert fields[0]["field"] == "body.employee_code"
    assert "my-password-123" not in response.text


def test_unexpected_error_hides_internal_details(build_app: Callable[..., FastAPI]) -> None:
    client = build_app_with_test_routes(build_app)

    response = client.get("/test/crash")

    assert response.status_code == 500
    assert_standard_error(response.json(), "INTERNAL_ERROR")
    assert "secret internal detail" not in response.text
    assert "Traceback" not in response.text
    assert response.headers.get("X-Request-ID")


def test_api_error_keeps_its_code_status_and_details(build_app: Callable[..., FastAPI]) -> None:
    client = build_app_with_test_routes(build_app)

    response = client.get("/test/api-error")

    assert response.status_code == 409
    assert_standard_error(response.json(), "QR_REVOKED")
    assert response.json()["error"]["details"] == {"card": "A1"}
