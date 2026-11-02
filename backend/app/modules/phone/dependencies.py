"""Who is calling a phone page: the employee of the `ups_phone` cookie (M4b spec §5, §7 rule 4).

The phone cookie and the admin cookie never mix: this dependency reads ONLY `ups_phone`, the admin
dependencies read only `ups_session`, and the phone cookie is sent only to /api/v1/phone. Every
request re-checks the sign-in, that the employee is still active and that phone punching is still
ON; when one of them is no longer true, the sign-in ends here.
"""

from dataclasses import dataclass

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.phone.access import phone_punch_on
from app.modules.phone.models import PhoneSession, SessionRevokeKind
from app.modules.phone.sessions import end_one, find_by_token, is_alive, note_use
from app.modules.settings.service import get_int_setting

PHONE_COOKIE_NAME = "ups_phone"
PHONE_COOKIE_PATH = "/api/v1/phone"


@dataclass(frozen=True)
class PhoneEmployee:
    employee: Employee
    phone_session: PhoneSession
    ip: str

    @property
    def actor(self) -> Actor:
        return Actor("employee", self.employee.id, self.ip)


def set_phone_cookie(response: Response, token: str, max_age_seconds: int) -> None:
    response.set_cookie(
        PHONE_COOKIE_NAME,
        token,
        max_age=max_age_seconds,
        httponly=True,  # page scripts can never read the token
        samesite="strict",  # never sent by a link or a form on another website
        # HTTPS only, except on a developer's laptop (http://localhost).
        secure=get_settings().app_env != "development",
        path=PHONE_COOKIE_PATH,  # admin endpoints never receive it
    )


def clear_phone_cookie(response: Response) -> None:
    response.delete_cookie(
        PHONE_COOKIE_NAME,
        path=PHONE_COOKIE_PATH,
        httponly=True,
        samesite="strict",
        secure=get_settings().app_env != "development",
    )


def require_phone_employee(
    request: Request, session: Session = Depends(get_session)
) -> PhoneEmployee:
    token = request.cookies.get(PHONE_COOKIE_NAME)
    phone_session = find_by_token(session, token) if token else None
    if phone_session is None:
        raise not_signed_in(None)
    if phone_session.revoked_at is not None:
        if phone_session.revoke_kind == SessionRevokeKind.PHONE_OFF.value:
            raise phone_punch_off()
        # The kind lets the phone say "You signed in on another phone" (new_login).
        raise not_signed_in(phone_session.revoke_kind)
    now = utc_now()
    if not is_alive(phone_session, now, get_int_setting(session, "phone_session_idle_days")):
        raise not_signed_in("expired")

    employee = session.get(Employee, phone_session.employee_id)
    if employee is None or employee.status != EmployeeStatus.ACTIVE.value:
        end_one(phone_session, SessionRevokeKind.LEFT, now)
        session.commit()
        raise not_signed_in(SessionRevokeKind.LEFT.value)
    if not phone_punch_on(session, employee.id):
        end_one(phone_session, SessionRevokeKind.PHONE_OFF, now)
        session.commit()
        raise phone_punch_off()

    note_use(session, phone_session, now)
    return PhoneEmployee(employee, phone_session, get_client_ip(request))


def not_signed_in(ended: str | None) -> ApiError:
    details = {"ended": ended} if ended else {}
    return ApiError("PHONE_NOT_SIGNED_IN", "Please sign in again.", 401, details)


def phone_punch_off() -> ApiError:
    return ApiError(
        "PHONE_PUNCH_OFF",
        "Phone attendance is switched off for you. Please visit the plant office.",
        403,
    )
