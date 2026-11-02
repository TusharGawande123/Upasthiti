"""F-70: a bell notice when one employee signs in on many different phones (M4b spec §7 rule 27).

A "phone" is the pair (browser, system) of a sign-in, so two phones of the same kind look like one:
the alert is a hint that an account may be shared, never a block. It goes to Super Admins only
(they alone act on phone access) and holds no name and no IP: only the count and the employee id.
At most one such notice per employee in 30 days.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import to_ist
from app.modules.employees.models import Employee
from app.modules.notifications.models import Notification
from app.modules.notifications.service import create_notification
from app.modules.phone.models import PhoneSession
from app.modules.settings.service import get_int_setting

KIND = "phone_many_phones"
WINDOW = timedelta(days=30)


def distinct_phones(session: Session, employee: Employee, now: datetime) -> int:
    kinds = session.execute(
        select(PhoneSession.browser, PhoneSession.system)
        .where(PhoneSession.employee_id == employee.id, PhoneSession.created_at >= now - WINDOW)
        .distinct()
    ).all()
    return len(kinds)


def note_sign_in(session: Session, employee: Employee, now: datetime) -> None:
    """Called after every successful sign-in (password, proof or passkey). Caller commits."""
    count = distinct_phones(session, employee, now)
    if count < get_int_setting(session, "phone_many_phones_alert_count"):
        return
    if _noticed_recently(session, employee, now):
        return
    create_notification(
        session,
        kind=KIND,
        severity="warning",
        plant_id=employee.plant_id,
        text_key=f"notification.{KIND}",
        params={"count": count},
        link=f"/admin/employees/{employee.id}?tab=phone",
        # One per employee and day at most by the key; one per 30 days by the check above.
        dedupe_key=f"{KIND}:{employee.id}:{to_ist(now).date().isoformat()}",
        subject_ids=[employee.id],
        now=now,
    )


def _noticed_recently(session: Session, employee: Employee, now: datetime) -> bool:
    return (
        session.scalar(
            select(Notification.id)
            .where(
                Notification.kind == KIND,
                Notification.subject_ids.contains([employee.id]),
                Notification.created_at > now - WINDOW,
            )
            .limit(1)
        )
        is not None
    )
