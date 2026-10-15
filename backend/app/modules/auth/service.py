"""Login, logout and login sessions (spec §7 rules 2–4, AC-2, AC-5, F-23).

How a session works:
1. Login creates a random 32-byte token. The browser keeps it in an HttpOnly cookie; the
   database keeps only its SHA-256 hash.
2. Every request sends the cookie; we look up the hash and check the session is not ended,
   not idle for too long (`session_idle_minutes`) and not too old (`session_max_hours`).
3. Logout, password change, deactivation, role change and force logout end sessions.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.auth.models import LoginSession
from app.modules.auth.passwords import (
    check_password_rules,
    hash_password,
    needs_rehash,
    verify_password,
    waste_time_like_a_password_check,
)
from app.modules.auth.rate_limit import login_limiter
from app.modules.settings.service import get_int_setting
from app.modules.users.models import User

# Writing last_seen_at on every request would be wasteful; once a minute is precise enough.
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=1)
USER_AGENT_MAX_LENGTH = 300


@dataclass(frozen=True)
class LoginResult:
    user: User
    token: str
    max_age_seconds: int  # how long the browser keeps the cookie


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(
    session: Session, *, login_name: str, password: str, ip: str, user_agent: str | None
) -> LoginResult:
    if not login_limiter.allow(ip):
        raise ApiError("TOO_MANY_REQUESTS", "Too many login attempts. Try again later.", 429)

    user = find_user_by_login(session, login_name)
    if user is None:
        waste_time_like_a_password_check(password)
        _record_failed_login(session, login_name=login_name, user=None, ip=ip)
        raise _invalid_credentials()

    now = utc_now()
    if user.locked_until is not None and user.locked_until > now:
        raise _account_locked(user.locked_until, now)
    if not user.is_active:
        raise ApiError("ACCOUNT_INACTIVE", "This account is switched off.", 403)

    if not verify_password(user.password_hash, password):
        _count_failed_password(session, user, ip, now)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    token = secrets.token_urlsafe(32)
    max_hours = get_int_setting(session, "session_max_hours")
    expires_at = now + timedelta(hours=max_hours)
    session.add(
        LoginSession(
            user_id=user.id,
            token_hash=hash_token(token),
            last_seen_at=now,
            expires_at=expires_at,
            ip=_ip_or_none(ip),
            user_agent=(user_agent or "")[:USER_AGENT_MAX_LENGTH] or None,
        )
    )
    record_audit(
        session,
        actor=Actor("user", user.id, ip),
        action="auth.login",
        entity_type="user",
        entity_id=user.id,
    )
    session.commit()
    cookie_lifetime = timedelta(hours=max_hours)
    return LoginResult(user=user, token=token, max_age_seconds=int(cookie_lifetime.total_seconds()))


def find_user_by_login(session: Session, login_name: str) -> User | None:
    """Usernames and emails are stored lower-case, so either can be typed in any case."""
    cleaned = login_name.strip().lower()
    return session.scalars(
        select(User).where(or_(User.username == cleaned, User.email == cleaned))
    ).first()


def find_valid_session(session: Session, token: str) -> tuple[LoginSession, User] | None:
    """The session and its user, or None when the token is unknown, ended or expired."""
    now = utc_now()
    row = session.execute(
        select(LoginSession, User)
        .join(User, User.id == LoginSession.user_id)
        .where(LoginSession.token_hash == hash_token(token))
    ).first()
    if row is None:
        return None
    login_session, user = row

    idle_limit = timedelta(minutes=get_int_setting(session, "session_idle_minutes"))
    if (
        login_session.revoked_at is not None
        or login_session.expires_at <= now
        or login_session.last_seen_at + idle_limit <= now
        or not user.is_active
    ):
        return None

    if now - login_session.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
        login_session.last_seen_at = now
        session.commit()
    return login_session, user


def logout(session: Session, *, login_session_id: uuid.UUID, actor: Actor) -> None:
    login_session = session.get(LoginSession, login_session_id)
    if login_session is not None and login_session.revoked_at is None:
        login_session.revoked_at = utc_now()
        record_audit(
            session,
            actor=actor,
            action="auth.logout",
            entity_type="user",
            entity_id=login_session.user_id,
        )
        session.commit()


def end_all_sessions(
    session: Session, user_id: uuid.UUID, *, except_session_id: uuid.UUID | None = None
) -> None:
    """End a user's sessions (password change keeps the current one). Caller commits."""
    statement = (
        update(LoginSession)
        .where(LoginSession.user_id == user_id, LoginSession.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    if except_session_id is not None:
        statement = statement.where(LoginSession.id != except_session_id)
    session.execute(statement)


def change_password(
    session: Session,
    *,
    user: User,
    current_session_id: uuid.UUID,
    current_password: str,
    new_password: str,
    actor: Actor,
) -> None:
    if not verify_password(user.password_hash, current_password):
        raise _invalid_credentials()
    check_password_rules(new_password, user.username, user.email)

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    end_all_sessions(session, user.id, except_session_id=current_session_id)
    record_audit(
        session,
        actor=actor,
        action="auth.change_password",
        entity_type="user",
        entity_id=user.id,
    )
    session.commit()


def list_active_sessions(session: Session, user_id: uuid.UUID) -> list[LoginSession]:
    now = utc_now()
    return list(
        session.scalars(
            select(LoginSession)
            .where(
                LoginSession.user_id == user_id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > now,
            )
            .order_by(LoginSession.last_seen_at.desc())
        )
    )


def end_one_session(
    session: Session, *, user_id: uuid.UUID, login_session_id: uuid.UUID, actor: Actor
) -> None:
    """A user logs out one of their own other devices (F-23)."""
    login_session = session.get(LoginSession, login_session_id)
    if login_session is None or login_session.user_id != user_id:
        raise ApiError("NOT_FOUND", "Session not found.", 404)
    if login_session.revoked_at is None:
        login_session.revoked_at = utc_now()
        record_audit(
            session,
            actor=actor,
            action="auth.end_session",
            entity_type="user",
            entity_id=user_id,
        )
        session.commit()


def _count_failed_password(session: Session, user: User, ip: str, now: datetime) -> None:
    """Count a wrong password; lock the account at the limit (spec §7 rule 4). Always raises."""
    user.failed_login_count += 1
    max_failures = get_int_setting(session, "login_max_failures")
    locked = user.failed_login_count >= max_failures
    if locked:
        lock_minutes = get_int_setting(session, "login_lock_minutes")
        user.locked_until = now + timedelta(minutes=lock_minutes)
        user.failed_login_count = 0
    _record_failed_login(session, login_name=user.username, user=user, ip=ip, locked=locked)
    if locked and user.locked_until is not None:
        raise _account_locked(user.locked_until, now)
    raise _invalid_credentials()


def _record_failed_login(
    session: Session, *, login_name: str, user: User | None, ip: str, locked: bool = False
) -> None:
    # Only the login name is stored, never the password that was typed.
    record_audit(
        session,
        actor=Actor("user", None, ip),
        action="auth.login_failed",
        entity_type="user",
        entity_id=user.id if user else None,
        after={"login": login_name[:254], "account_locked": locked},
    )
    session.commit()


def _invalid_credentials() -> ApiError:
    # One message for "no such user" and "wrong password", so names cannot be guessed.
    return ApiError("INVALID_CREDENTIALS", "Username/email or password is wrong.", 401)


def _account_locked(locked_until: datetime, now: datetime) -> ApiError:
    minutes_left = max(1, int((locked_until - now).total_seconds() // 60) + 1)
    return ApiError(
        "ACCOUNT_LOCKED",
        "Too many wrong passwords. The account is locked for a while.",
        423,
        {"minutes_left": minutes_left},
    )


def _ip_or_none(ip: str) -> str | None:
    return None if ip == "unknown" else ip
