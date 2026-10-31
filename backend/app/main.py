"""Entry point of the Upasthiti backend: builds the FastAPI app.

Run locally with:  uv run fastapi dev app/main.py
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI

from app.api_docs import DOCS_URL, add_protected_docs
from app.core.body_limit import BodyLimitMiddleware
from app.core.config import get_settings, load_settings_or_exit
from app.core.errors import register_error_handlers
from app.core.logging import add_request_id_middleware, setup_logging
from app.core.security_headers import add_security_headers_middleware
from app.jobs.daily import run_daily_jobs_logged, start_scheduler
from app.modules.approvals.router import router as approvals_router
from app.modules.attendance.router import router as attendance_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.dependencies import check_same_origin
from app.modules.auth.router import router as auth_router
from app.modules.contractors.router import router as contractors_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.employees.router import router as employees_router
from app.modules.employees.search_router import router as search_router
from app.modules.face.engine_provider import get_face_engine
from app.modules.face.router import router as face_router
from app.modules.health.router import router as health_router
from app.modules.holidays.router import router as holidays_router
from app.modules.kiosks.router import router as kiosks_router
from app.modules.leave.router import router as leave_router
from app.modules.notices.router import router as notices_router
from app.modules.notifications.router import router as notifications_router
from app.modules.org.router import router as org_router
from app.modules.printing.router import router as printing_router
from app.modules.punches.admin_router import router as punch_log_router
from app.modules.punches.review_router import router as review_router
from app.modules.punches.router import router as punches_router
from app.modules.qr_cards.router import router as qr_cards_router
from app.modules.regularisations.router import router as regularisations_router
from app.modules.settings.privacy_router import router as privacy_router
from app.modules.settings.router import router as settings_router
from app.modules.users.router import router as users_router

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start loading the face models, and the scheduled jobs (not in tests).

    The models load in the background: the health check and card punches answer at once
    (spec M3 S-31)."""
    get_face_engine().start_loading()
    if not get_settings().run_scheduler:
        yield
        return
    run_daily_jobs_logged()  # catch up after a sleep (Render's free plan)
    scheduler = start_scheduler()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


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
        lifespan=lifespan,
        openapi_url=openapi_url if docs_open_to_all else None,
    )
    if not docs_open_to_all:
        add_protected_docs(app, openapi_url)

    add_security_headers_middleware(app)
    add_request_id_middleware(app)
    # Added last, so it is the outermost layer and sees the bytes before anything reads them.
    app.add_middleware(BodyLimitMiddleware)
    register_error_handlers(app)

    # Every write request must come from our own site (CSRF protection, spec §8).
    api_router = APIRouter(prefix=API_PREFIX, dependencies=[Depends(check_same_origin)])
    api_router.include_router(health_router)
    api_router.include_router(auth_router)
    api_router.include_router(users_router)
    api_router.include_router(settings_router)
    api_router.include_router(privacy_router)
    api_router.include_router(audit_router)
    api_router.include_router(org_router)
    api_router.include_router(kiosks_router)
    api_router.include_router(contractors_router)
    api_router.include_router(employees_router)
    api_router.include_router(qr_cards_router)
    api_router.include_router(face_router)
    api_router.include_router(printing_router)
    api_router.include_router(punches_router)
    api_router.include_router(punch_log_router)
    api_router.include_router(review_router)
    api_router.include_router(notices_router)
    api_router.include_router(approvals_router)
    api_router.include_router(search_router)
    api_router.include_router(holidays_router)
    api_router.include_router(leave_router)
    api_router.include_router(regularisations_router)
    api_router.include_router(attendance_router)
    api_router.include_router(notifications_router)
    api_router.include_router(dashboard_router)
    app.include_router(api_router)
    return app


app = create_app()
