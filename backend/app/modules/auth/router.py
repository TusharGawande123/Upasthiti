"""Auth endpoints: login, logout, "who am I", change password, my sessions (spec §5.1)."""

import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.config import get_settings
from app.core.db import get_session
from app.modules.auth import service
from app.modules.auth.dependencies import (
    SESSION_COOKIE_NAME,
    CurrentUser,
    get_current_user,
    get_user_even_if_password_change_pending,
)
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    SessionResponse,
)
from app.modules.users.plant_access import load_plant_ids

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=MeResponse)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> MeResponse:
    result = service.login(
        session,
        login_name=body.login,
        password=body.password,
        ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        result.token,
        max_age=result.max_age_seconds,
        httponly=True,  # page scripts can never read the token
        samesite="lax",
        secure=settings.is_production,  # HTTPS only on the real site
        path="/",
    )
    return MeResponse.from_user(result.user, frozenset(load_plant_ids(session, result.user.id)))


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    current_user: CurrentUser = Depends(get_user_even_if_password_change_pending),
    session: Session = Depends(get_session),
) -> None:
    service.logout(
        session, login_session_id=current_user.login_session_id, actor=current_user.actor
    )
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=MeResponse)
def me(
    current_user: CurrentUser = Depends(get_user_even_if_password_change_pending),
) -> MeResponse:
    return MeResponse.from_user(current_user.user, current_user.plant_ids)


@router.post("/change-password", status_code=204)
def change_password(
    body: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_user_even_if_password_change_pending),
    session: Session = Depends(get_session),
) -> None:
    service.change_password(
        session,
        user=current_user.user,
        current_session_id=current_user.login_session_id,
        current_password=body.current_password,
        new_password=body.new_password,
        actor=current_user.actor,
    )


@router.get("/sessions", response_model=list[SessionResponse])
def my_sessions(
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SessionResponse]:
    return [
        SessionResponse(
            id=login_session.id,
            created_at=login_session.created_at,
            last_seen_at=login_session.last_seen_at,
            ip=str(login_session.ip) if login_session.ip else None,
            browser=login_session.user_agent,
            is_current=login_session.id == current_user.login_session_id,
        )
        for login_session in service.list_active_sessions(session, current_user.id)
    ]


@router.delete("/sessions/{login_session_id}", status_code=204)
def end_session(
    login_session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    service.end_one_session(
        session,
        user_id=current_user.id,
        login_session_id=login_session_id,
        actor=current_user.actor,
    )
