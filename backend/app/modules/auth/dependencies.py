"""FastAPI dependencies for logged-in users: who is calling, and may they do this?

Use in routers:
    user: CurrentUser = Depends(require(Capability.VIEW_EMPLOYEES))
`require` checks the role matrix (permissions.py); services then limit queries to
`user.plant_ids` when the access is OWN_PLANT.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import ApiError
from app.modules.audit.service import Actor
from app.modules.auth.permissions import Access, Capability, access_for
from app.modules.auth.service import find_valid_session
from app.modules.users.models import User
from app.modules.users.plant_access import load_plant_ids

SESSION_COOKIE_NAME = "ups_session"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True)
class CurrentUser:
    user: User
    login_session_id: uuid.UUID
    plant_ids: frozenset[uuid.UUID]
    ip: str

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def actor(self) -> Actor:
        return Actor("user", self.user.id, self.ip)

    def access(self, capability: Capability) -> Access | None:
        return access_for(self.role, capability)


def check_same_origin(request: Request) -> None:
    """Refuse write requests sent from another website (CSRF protection, spec §8).

    Browsers always add an Origin header to cross-site writes, and a site cannot fake it.
    """
    if request.method in SAFE_METHODS:
        return
    allowed_origin = get_settings().allowed_origin
    origin = request.headers.get("origin")
    if origin is not None:
        if origin.rstrip("/") == allowed_origin:
            return
    else:
        referer = request.headers.get("referer", "")
        if referer.startswith(allowed_origin + "/"):
            return
    raise ApiError("ORIGIN_NOT_ALLOWED", "This request did not come from Upasthiti.", 403)


def load_current_user(request: Request, session: Session) -> CurrentUser:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    found = find_valid_session(session, token) if token else None
    if found is None:
        raise ApiError("NOT_AUTHENTICATED", "Please log in.", 401)
    login_session, user = found
    return CurrentUser(
        user=user,
        login_session_id=login_session.id,
        plant_ids=frozenset(load_plant_ids(session, user.id)),
        ip=get_client_ip(request),
    )


def get_user_even_if_password_change_pending(
    request: Request, session: Session = Depends(get_session)
) -> CurrentUser:
    """Only for "me", "change password" and "logout"."""
    return load_current_user(request, session)


def get_current_user(
    current_user: CurrentUser = Depends(get_user_even_if_password_change_pending),
) -> CurrentUser:
    # A user with a temporary password must choose their own first (spec §4.1).
    if current_user.user.must_change_password:
        raise ApiError("PASSWORD_CHANGE_REQUIRED", "Please set a new password first.", 403)
    return current_user


def require(capability: Capability) -> Callable[..., CurrentUser]:
    """Dependency factory: the user must have `capability` in the role matrix."""

    def check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.access(capability) is None:
            raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
        return current_user

    return check
