"""Request and response shapes for login, "who am I", password change and sessions."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.users.models import User


class LoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=254)  # username or email
    password: str = Field(min_length=1, max_length=200)


class MeResponse(BaseModel):
    id: uuid.UUID
    name: str
    username: str
    email: str | None
    role: str
    plant_ids: list[uuid.UUID]
    must_change_password: bool

    @classmethod
    def from_user(cls, user: User, plant_ids: frozenset[uuid.UUID]) -> MeResponse:
        return cls(
            id=user.id,
            name=user.name,
            username=user.username,
            email=user.email,
            role=user.role,
            plant_ids=sorted(plant_ids),
            must_change_password=user.must_change_password,
        )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class SessionResponse(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    ip: str | None
    browser: str | None
    is_current: bool
