"""Response shapes for the health endpoints."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class FaceHealth(BaseModel):
    """M3 (S-31): whether face recognition works. No personal data, no database access."""

    state: Literal["loading", "ready", "off", "failed"]
    model_pack: str | None
    antispoof_model: str | None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    server_time: datetime  # UTC, sent as ISO 8601
    face: FaceHealth | None = None


class ReadyResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
