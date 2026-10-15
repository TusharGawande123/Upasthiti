"""The interactive API docs (/api/docs) and the OpenAPI file.

Development and test: open to everyone, as FastAPI does by default.
Production: only for a logged-in Super Admin (SRS §5.c). Everyone else gets 404, so the
docs do not even reveal that they exist.
"""

from fastapi import Depends, FastAPI, Request
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.modules.auth.dependencies import load_current_user
from app.modules.auth.permissions import Capability

DOCS_URL = "/api/docs"


def super_admin_or_not_found(request: Request, session: Session = Depends(get_session)) -> None:
    try:
        current_user = load_current_user(request, session)
    except ApiError as error:
        raise ApiError("NOT_FOUND", "Not Found", 404) from error
    is_super_admin = current_user.access(Capability.MANAGE_USERS) is not None
    if not is_super_admin or current_user.user.must_change_password:
        raise ApiError("NOT_FOUND", "Not Found", 404)


def add_protected_docs(app: FastAPI, openapi_url: str) -> None:
    """Production only: docs and OpenAPI file behind a Super Admin login."""

    @app.get(openapi_url, include_in_schema=False)
    def openapi_file(_: None = Depends(super_admin_or_not_found)) -> JSONResponse:
        return JSONResponse(app.openapi())

    @app.get(DOCS_URL, include_in_schema=False)
    def docs_page(_: None = Depends(super_admin_or_not_found)) -> HTMLResponse:
        return get_swagger_ui_html(openapi_url=openapi_url, title="Upasthiti API")
