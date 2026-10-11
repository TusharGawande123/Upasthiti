"""The one error format used by every API response that fails.

Every error looks like: { "error": { "code": "...", "message": "...", "details": {...} } }
The code is stable and doubles as the translation key the frontend and kiosk show
(docs/SRS.md §5.a). Messages are short English text for developers and logs.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

# Codes for the plain HTTP errors that FastAPI/Starlette raise themselves.
HTTP_STATUS_TO_CODE = {
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
}


class ApiError(Exception):
    """Raise this from any endpoint or service to return a standard error response."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def error_response(
    status_code: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details or {}}}
    return JSONResponse(status_code=status_code, content=body)


async def handle_api_error(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, ApiError)  # noqa: S101  (registered only for ApiError)
    return error_response(error.status_code, error.code, error.message, error.details)


async def handle_validation_error(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)  # noqa: S101
    # We list which fields are wrong and why, but never echo the submitted values:
    # they could contain passwords or personal data.
    fields = [
        {
            "field": ".".join(str(part) for part in problem["loc"]),
            "problem": problem["msg"],
        }
        for problem in error.errors()
    ]
    return error_response(422, "VALIDATION_FAILED", "The request is not valid.", {"fields": fields})


async def handle_http_error(request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, StarletteHTTPException)  # noqa: S101
    code = HTTP_STATUS_TO_CODE.get(error.status_code, "HTTP_ERROR")
    return error_response(error.status_code, code, str(error.detail))


async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    # The full error goes to the server log only. The response stays generic so that no
    # stack trace or internal detail ever reaches a browser or kiosk.
    logger.exception("Unhandled error", exc_info=error)
    response = error_response(500, "INTERNAL_ERROR", "Something went wrong on the server.")
    # This handler runs outside the request-ID middleware, so we add the header here.
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        response.headers[REQUEST_ID_HEADER] = request_id
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
