"""User management endpoints, Super Admin only (spec §5.1)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.users import service
from app.modules.users.models import Role, User
from app.modules.users.plant_access import load_plant_ids
from app.modules.users.schemas import (
    CreateUserRequest,
    NewUserResponse,
    ReasonRequest,
    TemporaryPasswordResponse,
    UpdateUserRequest,
    UserResponse,
)

router = APIRouter(prefix="/users", tags=["users"])
super_admin = require(Capability.MANAGE_USERS)


def to_response(session: Session, user: User) -> UserResponse:
    return UserResponse.from_user(user, load_plant_ids(session, user.id))


@router.get("", response_model=Page[UserResponse])
def list_users(
    role: Role | None = None,
    is_active: bool | None = None,
    q: str | None = Query(default=None, max_length=100),
    params: PageParams = Depends(page_params),
    _: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> Page[UserResponse]:
    users, total = service.list_users(
        session, params, role=role.value if role else None, is_active=is_active, search=q
    )
    return Page(
        items=[to_response(session, user) for user in users],
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.post("", response_model=NewUserResponse, status_code=201)
def create_user(
    body: CreateUserRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> NewUserResponse:
    created = service.create_user(
        session,
        actor=current_user.actor,
        name=body.name,
        username=body.username,
        email=body.email,
        role=body.role,
        plant_id=body.plant_id,
    )
    return NewUserResponse(
        user=to_response(session, created.user),
        temporary_password=created.temporary_password,
    )


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> UserResponse:
    user = service.update_user(
        session,
        actor=current_user.actor,
        user=service.get_user(session, user_id),
        name=body.name,
        username=body.username,
        email=body.email,
        email_given="email" in body.model_fields_set,  # "email": null removes it
        role=body.role,
        plant_id=body.plant_id,
    )
    return to_response(session, user)


@router.post("/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(
    user_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> UserResponse:
    user = service.set_user_active(
        session,
        actor=current_user.actor,
        user=service.get_user(session, user_id),
        active=False,
        reason=body.reason,
    )
    return to_response(session, user)


@router.post("/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> UserResponse:
    user = service.set_user_active(
        session,
        actor=current_user.actor,
        user=service.get_user(session, user_id),
        active=True,
        reason=body.reason,
    )
    return to_response(session, user)


@router.post("/{user_id}/reset-password", response_model=TemporaryPasswordResponse)
def reset_password(
    user_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> TemporaryPasswordResponse:
    temporary_password = service.reset_password(
        session,
        actor=current_user.actor,
        user=service.get_user(session, user_id),
        reason=body.reason,
    )
    return TemporaryPasswordResponse(temporary_password=temporary_password)


@router.post("/{user_id}/force-logout", status_code=204)
def force_logout(
    user_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> None:
    service.force_logout(
        session,
        actor=current_user.actor,
        user=service.get_user(session, user_id),
        reason=body.reason,
    )
