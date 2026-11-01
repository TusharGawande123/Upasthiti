"""Employee sign-in with employee code + password, and sign-out (M4b spec §7 rules 4, 7, 9).

The order of the checks matters (rule 4):
1. per-IP limit;
2. unknown code, no password yet, or an employee who has left: ONE answer,
   PHONE_CREDENTIALS_INVALID, after a dummy Argon2 check, so the timing tells nothing;
3. locked account: PHONE_ACCOUNT_LOCKED with the minutes left;
4. wrong password: counted; the account locks at `phone_login_max_failures`;
5. right password, but a new password is required or phone punching is OFF: refused, no sign-in;
6. success: failures cleared, a new sign-in (older ones end: one phone at a time).
Every Argon2 check, real or dummy, holds one of the 2 slots of app/core/password_gate.py, because
each one needs about 64 MB on the 512 MB server.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.password_gate import password_check_slot
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.auth.passwords import (
    hash_password,
    needs_rehash,
    verify_password,
    waste_time_like_a_password_check,
)
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.employees.rules import clean_code
from app.modules.phone.access import phone_punch_on
from app.modules.phone.access_service import account_of
from app.modules.phone.dependencies import PhoneEmployee, phone_punch_off
from app.modules.phone.many_phones import note_sign_in
from app.modules.phone.models import PhoneAccount, SessionRevokeKind, SignInMethod
from app.modules.phone.notice import notice_required
from app.modules.phone.rate_limits import phone_sign_in_limiter
from app.modules.phone.sessions import NewSignIn, end_one, lock_employee, start_session
from app.modules.settings.service import get_int_setting


@dataclass(frozen=True)
class SignedIn:
    employee: Employee
    sign_in: NewSignIn
    notice_required: bool


def check_sign_in_limit(ip: str) -> None:
    """Password and passkey sign-ins share 20 tries per IP in 10 minutes (spec §7 rule 8)."""
    if not phone_sign_in_limiter.allow(ip):
        raise ApiError("TOO_MANY_REQUESTS", "Too many sign-in attempts. Try again later.", 429)


def find_employee_by_code(session: Session, code: str) -> Employee | None:
    return session.scalar(select(Employee).where(Employee.employee_code == clean_code(code)))


def sign_in_with_password(
    session: Session, *, code: str, password: str, ip: str, user_agent: str | None
) -> SignedIn:
    check_sign_in_limit(ip)
    employee = find_employee_by_code(session, code)
    account = account_of(session, employee.id) if employee is not None else None
    usable = (
        employee is not None
        and employee.status == EmployeeStatus.ACTIVE.value
        and account is not None
        and account.password_hash is not None
    )
    if not usable or employee is None or account is None or account.password_hash is None:
        dummy_password_check(password)
        _record_failure(session, code, employee, ip)
        raise credentials_invalid()

    now = utc_now()
    if account.locked_until is not None and account.locked_until > now:
        raise account_locked(account.locked_until, now)
    if not password_matches(account.password_hash, password):
        _count_wrong_password(session, account, code, employee, ip, now)

    account.failed_login_count = 0
    account.locked_until = None
    check_may_sign_in(session, employee, account)
    if needs_rehash(account.password_hash):
        with password_check_slot():
            account.password_hash = hash_password(password)
    return finish_sign_in(
        session, employee, method=SignInMethod.PASSWORD, ip=ip, user_agent=user_agent, now=now
    )


def password_matches(password_hash: str, password: str) -> bool:
    """One real Argon2 check, inside one of the 2 slots (rule 9)."""
    with password_check_slot():
        return verify_password(password_hash, password)


def dummy_password_check(password: str) -> None:
    """The same work as a real check, for an unknown code, so the timing tells nothing."""
    with password_check_slot():
        waste_time_like_a_password_check(password)


def check_may_sign_in(session: Session, employee: Employee, account: PhoneAccount | None) -> None:
    """After a right password (or a working passkey): no sign-in when the Super Admin required a
    new password or phone punching is OFF (rule 4). The failure count reset is saved."""
    if account is not None and account.new_password_required_at is not None:
        session.commit()
        raise ApiError(
            "PHONE_NEW_PASSWORD_REQUIRED",
            "Please set a new password: tap 'First time or forgot your password?'.",
            409,
        )
    if not phone_punch_on(session, employee.id):
        session.commit()
        raise phone_punch_off()


def finish_sign_in(
    session: Session,
    employee: Employee,
    *,
    method: SignInMethod,
    ip: str,
    user_agent: str | None,
    now: datetime,
) -> SignedIn:
    """The shared end of every sign-in: the new sign-in row, the F-70 count, the audit row."""
    lock_employee(session, employee.id)
    sign_in = start_session(
        session, employee, method=method, ip=_ip_or_none(ip), user_agent=user_agent, now=now
    )
    note_sign_in(session, employee, now)
    record_audit(
        session,
        actor=Actor("employee", employee.id, ip),
        action="phone_auth.login",
        entity_type="employee",
        entity_id=employee.id,
        after={"method": method.value, "browser": sign_in.phone_session.browser},
        plant_id=employee.plant_id,
    )
    session.commit()
    return SignedIn(employee, sign_in, notice_required(session, employee.id))


def sign_out(session: Session, caller: PhoneEmployee) -> None:
    end_one(caller.phone_session, SessionRevokeKind.LOGOUT, utc_now())
    record_audit(
        session,
        actor=caller.actor,
        action="phone_auth.logout",
        entity_type="employee",
        entity_id=caller.employee.id,
        plant_id=caller.employee.plant_id,
    )
    session.commit()


def _count_wrong_password(
    session: Session, account: PhoneAccount, code: str, employee: Employee, ip: str, now: datetime
) -> None:
    """Count a wrong password; lock the account at the limit (rule 7). Always raises."""
    account.failed_login_count += 1
    locked = account.failed_login_count >= get_int_setting(session, "phone_login_max_failures")
    if locked:
        account.locked_until = now + timedelta(
            minutes=get_int_setting(session, "phone_login_lock_minutes")
        )
        account.failed_login_count = 0
    _record_failure(session, code, employee, ip, locked=locked)
    if locked and account.locked_until is not None:
        raise account_locked(account.locked_until, now)
    raise credentials_invalid()


def _record_failure(
    session: Session, code: str, employee: Employee | None, ip: str, *, locked: bool = False
) -> None:
    # Only the typed code is stored, never the password.
    record_audit(
        session,
        actor=Actor("employee", None, ip),
        action="phone_auth.login_failed",
        entity_type="employee",
        entity_id=employee.id if employee else None,
        after={"code": clean_code(code)[:12], "method": "password", "account_locked": locked},
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()


def credentials_invalid() -> ApiError:
    # One answer for "no such code", "no password yet", "has left" and "wrong password".
    return ApiError(
        "PHONE_CREDENTIALS_INVALID",
        "Employee code or password is wrong. First time? Set your password.",
        401,
    )


def account_locked(locked_until: datetime, now: datetime) -> ApiError:
    # Whole minutes, rounded up: locked at 08:00 for 15 minutes, asked at 08:05 = 10 (AC-6).
    minutes_left = max(1, math.ceil((locked_until - now).total_seconds() / 60))
    return ApiError(
        "PHONE_ACCOUNT_LOCKED",
        "Too many wrong passwords. Try again later, or set a new password.",
        423,
        {"minutes_left": minutes_left},
    )


def _ip_or_none(ip: str) -> str | None:
    return None if ip == "unknown" else ip
