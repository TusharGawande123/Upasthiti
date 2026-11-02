"""Employee sign-ins on a phone (M4b spec §7 rule 4).

How a phone sign-in works (the same idea as the admin sessions, but its own table and cookie):
1. A sign-in makes a random 32-byte token. The phone keeps it in the HttpOnly cookie `ups_phone`
   (path /api/v1/phone only); the database keeps only its SHA-256 hash.
2. "One phone at a time": when the employee already has `phone_max_sessions` working sign-ins, the
   oldest ones end (`new_login`) in the same transaction as the new one.
3. A sign-in ends after `phone_session_idle_days` without use, `phone_session_max_days` after it
   started, or when something ends it (logout, a new password, the Super Admin, phone punching
   switched off, the employee leaving). Ended rows keep their reason in `revoke_kind`.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.modules.employees.models import Employee
from app.modules.phone.models import PhoneSession, SessionRevokeKind, SignInMethod
from app.modules.phone.user_agent import phone_kind, short_user_agent
from app.modules.settings.service import get_int_setting

# Writing last_seen_at on every request would be wasteful; once a minute is precise enough.
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=1)


@dataclass(frozen=True)
class NewSignIn:
    phone_session: PhoneSession
    token: str  # goes into the cookie once; never stored
    max_age_seconds: int  # how long the browser keeps the cookie


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def lock_employee(session: Session, employee_id: uuid.UUID) -> None:
    """Two sign-ins of one employee at the same second wait for each other (spec §9), so
    "one phone at a time" cannot be beaten in parallel."""
    session.execute(select(Employee.id).where(Employee.id == employee_id).with_for_update())


def is_alive(phone_session: PhoneSession, now: datetime, idle_days: int) -> bool:
    """Not ended, not past its end, not idle for too long."""
    return (
        phone_session.revoked_at is None
        and phone_session.expires_at > now
        and phone_session.last_seen_at + timedelta(days=idle_days) > now
    )


def alive_sessions(session: Session, employee_id: uuid.UUID, now: datetime) -> list[PhoneSession]:
    """The employee's working sign-ins, oldest first."""
    idle_days = get_int_setting(session, "phone_session_idle_days")
    rows = session.scalars(
        select(PhoneSession)
        .where(PhoneSession.employee_id == employee_id, PhoneSession.revoked_at.is_(None))
        .order_by(PhoneSession.created_at, PhoneSession.id)
    )
    return [row for row in rows if is_alive(row, now, idle_days)]


def start_session(
    session: Session,
    employee: Employee,
    *,
    method: SignInMethod,
    ip: str | None,
    user_agent: str | None,
    now: datetime,
) -> NewSignIn:
    """A new sign-in; the caller holds the employee's row lock and commits."""
    max_sessions = get_int_setting(session, "phone_max_sessions")
    alive = alive_sessions(session, employee.id, now)
    surplus = len(alive) - max_sessions + 1
    for old in alive[: max(0, surplus)]:
        end_one(old, SessionRevokeKind.NEW_LOGIN, now)

    token = secrets.token_urlsafe(32)
    max_days = get_int_setting(session, "phone_session_max_days")
    kind = phone_kind(user_agent)
    phone_session = PhoneSession(
        employee_id=employee.id,
        token_hash=hash_token(token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=max_days),
        ip=ip,
        browser=kind.browser,
        system=kind.system,
        user_agent=short_user_agent(user_agent),
        sign_in_method=method.value,
    )
    session.add(phone_session)
    session.flush()
    return NewSignIn(phone_session, token, max_days * 24 * 60 * 60)


def end_one(phone_session: PhoneSession, kind: SessionRevokeKind, now: datetime) -> None:
    if phone_session.revoked_at is None:
        phone_session.revoked_at = now
        phone_session.revoke_kind = kind.value


def end_all(
    session: Session,
    employee_id: uuid.UUID,
    kind: SessionRevokeKind,
    now: datetime,
    *,
    except_session_id: uuid.UUID | None = None,
) -> int:
    """End every sign-in of the employee that has not ended or run out yet; returns how many.
    Caller commits."""
    statement = (
        update(PhoneSession)
        .where(
            PhoneSession.employee_id == employee_id,
            PhoneSession.revoked_at.is_(None),
            PhoneSession.expires_at > now,
        )
        .values(revoked_at=now, revoke_kind=kind.value)
        .returning(PhoneSession.id)
    )
    if except_session_id is not None:
        statement = statement.where(PhoneSession.id != except_session_id)
    ended = session.execute(statement.execution_options(synchronize_session="fetch")).all()
    return len(ended)


def find_by_token(session: Session, token: str) -> PhoneSession | None:
    return session.scalar(select(PhoneSession).where(PhoneSession.token_hash == hash_token(token)))


def note_use(session: Session, phone_session: PhoneSession, now: datetime) -> None:
    if now - phone_session.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
        phone_session.last_seen_at = now
        session.commit()
