"""Health endpoints: is the server up, and can it reach the database?

/health is called every 10 minutes by the keep-alive workflow, so it must stay cheap and
never touch the database. /health/ready also checks the database.
"""

import logging

from fastapi import APIRouter, Depends

from app.core.config import get_settings
from app.core.db import check_database_connection
from app.core.errors import ApiError
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.modules.face.engine_provider import get_face_engine
from app.modules.health.schemas import FaceHealth, HealthResponse, ReadyResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
def get_health(engine: FaceEngine = Depends(get_face_engine)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=get_settings().app_version,
        server_time=utc_now(),
        face=FaceHealth(
            state=engine.state.value,  # type: ignore[arg-type]
            model_pack=engine.model_pack,
            antispoof_model=engine.antispoof_id,
        ),
    )


@router.get("/ready", response_model=ReadyResponse)
def get_readiness() -> ReadyResponse:
    try:
        check_database_connection()
    except Exception as error:
        # Log only the error type; tell the caller only that the database is down.
        # The driver's message can contain the host name or user, so it is never logged or returned.
        logger.warning("Database check failed: %s", type(error).__name__)
        raise ApiError(
            "DATABASE_UNAVAILABLE", "The database cannot be reached.", status_code=503
        ) from error
    return ReadyResponse(status="ok", database="ok")
