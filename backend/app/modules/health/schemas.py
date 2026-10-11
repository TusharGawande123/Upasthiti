"""Response shapes for the health endpoints."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    server_time: datetime  # UTC, sent as ISO 8601


class ReadyResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
