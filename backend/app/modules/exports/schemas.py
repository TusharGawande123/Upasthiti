"""Request and response shapes of the full data export (M6 spec section 5)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr


class FullExportRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    # The Super Admin types his password again; a wrong one counts toward the lockout.
    password: SecretStr = Field(min_length=1, max_length=200)


class RecentExport(BaseModel):
    at: datetime
    actor_name: str | None
    status: Literal["done", "interrupted"]
    size_bytes: int | None
    row_count: int | None
    reason: str | None
