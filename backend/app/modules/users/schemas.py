"""Request and response shapes for admin user management."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.users.models import Role, User


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    username: str
    email: str | None
    role: str
    plant_id: uuid.UUID | None
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime

    @classmethod
    def from_user(cls, user: User, plant_ids: list[uuid.UUID]) -> UserResponse:
        return cls(
            id=user.id,
            name=user.name,
            username=user.username,
            email=user.email,
            role=user.role,
            plant_id=plant_ids[0] if plant_ids else None,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            last_login_at=user.last_login_at,
            created_at=user.created_at,
        )


class CreateUserRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=1, max_length=30)
    email: str | None = Field(default=None, max_length=254)
    role: Role
    plant_id: uuid.UUID | None = None


class UpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    username: str | None = Field(default=None, min_length=1, max_length=30)
    email: str | None = Field(default=None, max_length=254)
    role: Role | None = None
    plant_id: uuid.UUID | None = None


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class NewUserResponse(BaseModel):
    user: UserResponse
    temporary_password: str  # shown once; never stored or logged in plain text


class TemporaryPasswordResponse(BaseModel):
    temporary_password: str
