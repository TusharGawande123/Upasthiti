"""Admin user management by the Super Admin (spec §5.1, §7 rule 1).

Rules that protect the company from locking itself out:
- there is always at least one active Super Admin (LAST_SUPER_ADMIN);
- nobody can switch off their own account (CANNOT_DEACTIVATE_SELF).
A Plant Head always has exactly one plant.
"""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.modules.audit.service import Actor, record_audit
from app.modules.auth.passwords import (
    check_password_rules,
    generate_temporary_password,
    hash_password,
)
from app.modules.auth.service import end_all_sessions
from app.modules.users.models import Role, User
from app.modules.users.plant_access import load_plant_ids, set_user_plant

USERNAME_PATTERN = re.compile(r"^[a-z0-9._]{3,30}$")
# A light check only: we never send email in M1, we only need a sensible, unique value.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class NewUser:
    user: User
    temporary_password: str


def user_snapshot(session: Session, user: User) -> dict[str, object]:
    """The fields shown in the audit log for a user (never the password hash)."""
    return {
        "name": user.name,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "plant_ids": sorted(str(plant_id) for plant_id in load_plant_ids(session, user.id)),
    }


def list_users(
    session: Session,
    params: PageParams,
    *,
    role: str | None = None,
    is_active: bool | None = None,
    search: str | None = None,
) -> tuple[list[User], int]:
    statement = select(User).order_by(User.name)
    if role:
        statement = statement.where(User.role == role)
    if is_active is not None:
        statement = statement.where(User.is_active == is_active)
    if search:
        pattern = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(func.lower(User.name).like(pattern), User.username.like(pattern))
        )
    return fetch_page(session, statement, params)


def get_user(session: Session, user_id: uuid.UUID) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise ApiError("NOT_FOUND", "User not found.", 404)
    return user


def create_user(
    session: Session,
    *,
    actor: Actor,
    name: str,
    username: str,
    email: str | None,
    role: Role,
    plant_id: uuid.UUID | None,
) -> NewUser:
    username = _clean_username(username)
    email = _clean_email(email)
    _check_unique(session, username=username, email=email)
    _check_plant_for_role(role, plant_id)

    temporary_password = generate_temporary_password()
    user = User(
        name=name.strip(),
        username=username,
        email=email,
        password_hash=hash_password(temporary_password),
        role=role.value,
        must_change_password=True,
    )
    session.add(user)
    session.flush()  # gives the user an id
    if plant_id is not None:
        set_user_plant(session, user, plant_id)

    record_audit(
        session,
        actor=actor,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        after=user_snapshot(session, user),
        plant_id=plant_id,
    )
    session.commit()
    return NewUser(user=user, temporary_password=temporary_password)


def update_user(
    session: Session,
    *,
    actor: Actor,
    user: User,
    name: str | None = None,
    username: str | None = None,
    email: str | None = None,
    email_given: bool = False,
    role: Role | None = None,
    plant_id: uuid.UUID | None = None,
) -> User:
    before = user_snapshot(session, user)
    if username is not None:
        username = _clean_username(username)
        _check_unique(session, username=username, email=None, except_user_id=user.id)
        user.username = username
    if email_given:
        cleaned_email = _clean_email(email)
        _check_unique(session, username=None, email=cleaned_email, except_user_id=user.id)
        user.email = cleaned_email
    if name is not None:
        user.name = name.strip()

    new_role = role or Role(user.role)
    if new_role != Role.SUPER_ADMIN:
        _check_not_last_super_admin(session, user)
    if new_role == Role.PLANT_HEAD:
        new_plant_id = plant_id or _single_plant_or_none(session, user)
        _check_plant_for_role(new_role, new_plant_id)
        set_user_plant(session, user, new_plant_id)
    else:
        set_user_plant(session, user, None)  # other roles are not tied to a plant

    role_changed = new_role.value != user.role
    user.role = new_role.value
    if role_changed:
        # New rights take effect at once: the user must log in again.
        end_all_sessions(session, user.id)

    record_audit(
        session,
        actor=actor,
        action="user.update",
        entity_type="user",
        entity_id=user.id,
        before=before,
        after=user_snapshot(session, user),
    )
    session.commit()
    return user


def set_user_active(
    session: Session, *, actor: Actor, user: User, active: bool, reason: str
) -> User:
    if not active:
        if user.id == actor.actor_id:
            raise ApiError("CANNOT_DEACTIVATE_SELF", "You cannot switch off your own account.", 422)
        _check_not_last_super_admin(session, user)
        end_all_sessions(session, user.id)
    before = user_snapshot(session, user)
    user.is_active = active
    record_audit(
        session,
        actor=actor,
        action="user.reactivate" if active else "user.deactivate",
        entity_type="user",
        entity_id=user.id,
        before=before,
        after=user_snapshot(session, user),
        reason=reason,
    )
    session.commit()
    return user


def reset_password(session: Session, *, actor: Actor, user: User, reason: str) -> str:
    temporary_password = generate_temporary_password()
    user.password_hash = hash_password(temporary_password)
    user.must_change_password = True
    user.failed_login_count = 0
    user.locked_until = None
    end_all_sessions(session, user.id)
    record_audit(
        session,
        actor=actor,
        action="user.reset_password",
        entity_type="user",
        entity_id=user.id,
        reason=reason,
    )
    session.commit()
    return temporary_password


def force_logout(session: Session, *, actor: Actor, user: User, reason: str) -> None:
    end_all_sessions(session, user.id)
    record_audit(
        session,
        actor=actor,
        action="auth.force_logout",
        entity_type="user",
        entity_id=user.id,
        reason=reason,
    )
    session.commit()


def create_first_super_admin(
    session: Session, *, name: str, username: str, email: str | None, password: str
) -> User:
    """Used once, by the create_super_admin script. Refuses if an active one exists."""
    already = session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == Role.SUPER_ADMIN.value, User.is_active.is_(True))
    )
    if already:
        raise ApiError(
            "SUPER_ADMIN_EXISTS", "An active Super Admin already exists. Log in as them.", 409
        )
    username = _clean_username(username)
    email = _clean_email(email)
    _check_unique(session, username=username, email=email)
    check_password_rules(password, username, email)

    user = User(
        name=name.strip(),
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=Role.SUPER_ADMIN.value,
        must_change_password=False,
    )
    session.add(user)
    session.flush()
    record_audit(
        session,
        actor=Actor("system", None),
        action="user.create_first_super_admin",
        entity_type="user",
        entity_id=user.id,
        after=user_snapshot(session, user),
    )
    session.commit()
    return user


def _clean_username(username: str) -> str:
    cleaned = username.strip().lower()
    if not USERNAME_PATTERN.match(cleaned):
        raise ApiError(
            "USERNAME_INVALID",
            "Use 3–30 small letters, digits, dots or underscores.",
            422,
        )
    return cleaned


def _clean_email(email: str | None) -> str | None:
    if email is None or not email.strip():
        return None
    cleaned = email.strip().lower()
    # Length first: the pattern only ever sees short text, so it cannot be made slow.
    if len(cleaned) > 254 or not EMAIL_PATTERN.match(cleaned):
        raise ApiError("EMAIL_INVALID", "This email address does not look right.", 422)
    return cleaned


def _check_unique(
    session: Session,
    *,
    username: str | None,
    email: str | None,
    except_user_id: uuid.UUID | None = None,
) -> None:
    other_users = select(User.id)
    if except_user_id is not None:
        other_users = other_users.where(User.id != except_user_id)

    if username is not None and session.scalar(other_users.where(User.username == username)):
        raise ApiError("USERNAME_EXISTS", "This username is already used.", 409)
    if email is not None and session.scalar(other_users.where(User.email == email)):
        raise ApiError("EMAIL_EXISTS", "This email is already used.", 409)


def _check_plant_for_role(role: Role, plant_id: uuid.UUID | None) -> None:
    if role == Role.PLANT_HEAD and plant_id is None:
        raise ApiError("PLANT_REQUIRED_FOR_ROLE", "A Plant Head needs a plant.", 422)


def _single_plant_or_none(session: Session, user: User) -> uuid.UUID | None:
    plant_ids = load_plant_ids(session, user.id)
    return plant_ids[0] if plant_ids else None


def _check_not_last_super_admin(session: Session, user: User) -> None:
    """Refuse to remove the last active Super Admin (by deactivation or role change)."""
    if user.role != Role.SUPER_ADMIN.value or not user.is_active:
        return
    other_active = session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.role == Role.SUPER_ADMIN.value,
            User.is_active.is_(True),
            User.id != user.id,
        )
    )
    if not other_active:
        raise ApiError("LAST_SUPER_ADMIN", "At least one active Super Admin is needed.", 422)
