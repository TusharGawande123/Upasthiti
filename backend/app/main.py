"""Entry point of the Upasthiti backend: builds the FastAPI app.

Run locally with:  uv run fastapi dev app/main.py
"""

from fastapi import APIRouter, Depends, FastAPI

from app.api_docs import DOCS_URL, add_protected_docs
from app.core.config import load_settings_or_exit
from app.core.errors import register_error_handlers
from app.core.logging import add_request_id_middleware, setup_logging
from app.core.security_headers import add_security_headers_middleware
from app.modules.audit.router import router as audit_router
from app.modules.auth.dependencies import check_same_origin
from app.modules.auth.router import router as auth_router
from app.modules.health.router import router as health_router
from app.modules.kiosks.router import router as kiosks_router
from app.modules.org.router import router as org_router
from app.modules.settings.router import router as settings_router
from app.modules.users.router import router as users_router

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = load_settings_or_exit()
    setup_logging(settings.log_level)

    # The interactive API docs are open in development; in production only a logged-in
    # Super Admin sees them (docs/SRS.md §5.c, app/api_docs.py).
    openapi_url = f"{API_PREFIX}/openapi.json"
    docs_open_to_all = not settings.is_production
    app = FastAPI(
        title="Upasthiti API",
        version=settings.app_version,
        docs_url=DOCS_URL if docs_open_to_all else None,
        redoc_url=None,
        openapi_url=openapi_url if docs_open_to_all else None,
    )
    if not docs_open_to_all:
        add_protected_docs(app, openapi_url)

    add_security_headers_middleware(app)
    add_request_id_middleware(app)
    register_error_handlers(app)

    # Every write request must come from our own site (CSRF protection, spec §8).
    api_router = APIRouter(prefix=API_PREFIX, dependencies=[Depends(check_same_origin)])
    api_router.include_router(health_router)
    api_router.include_router(auth_router)
    api_router.include_router(users_router)
    api_router.include_router(settings_router)
    api_router.include_router(audit_router)
    api_router.include_router(org_router)
    api_router.include_router(kiosks_router)
    app.include_router(api_router)
    return app


app = create_app()
