"""Entry point of the Upasthiti backend: builds the FastAPI app.

Run locally with:  uv run fastapi dev app/main.py
"""

from fastapi import APIRouter, Depends, FastAPI

from app.core.config import load_settings_or_exit
from app.core.errors import register_error_handlers
from app.core.logging import add_request_id_middleware, setup_logging
from app.core.security_headers import add_security_headers_middleware
from app.modules.audit.router import router as audit_router
from app.modules.auth.dependencies import check_same_origin
from app.modules.auth.router import router as auth_router
from app.modules.health.router import router as health_router
from app.modules.settings.router import router as settings_router
from app.modules.users.router import router as users_router

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = load_settings_or_exit()
    setup_logging(settings.log_level)

    # The interactive API docs are switched off in production (docs/SRS.md §5.c).
    docs_enabled = not settings.is_production
    app = FastAPI(
        title="Upasthiti API",
        version=settings.app_version,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs_enabled else None,
    )

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
    app.include_router(api_router)
    return app


app = create_app()
