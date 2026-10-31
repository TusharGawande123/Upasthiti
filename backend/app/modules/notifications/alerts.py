"""The alert jobs of the notification centre (M5 spec §7 rules 19 and 20; F-4, F-62, F-65).

Every function is safe to repeat: a notification has a `dedupe_key`, so running a job twice, or
again after the free server slept, never makes a second one for the same thing. DEMO plants
(code starts with DEMO) never raise alerts.

- Every 5 minutes: `device_offline`, `still_inside` (F-4), `many_rejections`.
- Every morning at 07:00 IST: `incomplete_days`, `review_digest`, `absence_streak` (F-62), and on
  the 2nd of the month `monthly_register` (F-65).
- Every night: notifications older than `notification_keep_days` are deleted (alerts, not records).
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.time import to_ist
from app.modules.attendance.compute import shift_moments
from app.modules.attendance.day_window import AttendanceCalendar
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.read_service import DEMO_PREFIX
from app.modules.dashboard.service import people_inside
from app.modules.kiosks.models import KioskDevice, KioskStatus
from app.modules.kiosks.status_service import status_summary
from app.modules.notifications.models import Notification
from app.modules.notifications.service import (
    create_notification,
    resolve_notification,
    update_open_notification,
)
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchDecision
from app.modules.punches.review_service import review_digest
from app.modules.settings.service import get_int_setting

STREAK_LOOK_BACK_DAYS = 30
COOLDOWN = "COOLDOWN_ACTIVE"


def _real_plants(session: Session) -> list[Plant]:
    """Active plants without the DEMO ones, by code."""
    return [
        plant
        for plant in session.scalars(
            select(Plant).where(Plant.is_active.is_(True)).order_by(Plant.code)
        )
        if not plant.code.startswith(DEMO_PREFIX)
    ]


# --- Every 5 minutes ----------------------------------------------------------------------------


def run_five_minute_alerts(session: Session, now: datetime) -> None:
    """Device offline, people still inside, many refused punches. Commits."""
    plants = _real_plants(session)
    plant_ids = [plant.id for plant in plants]
    _device_offline(session, plant_ids, now)
    _still_inside(session, plants, now)
    _many_rejections(session, plant_ids, now)
    session.commit()


def _device_offline(session: Session, plant_ids: list[uuid.UUID], now: datetime) -> None:
    """One alert per device outage (the M4 rule, now also stored); resolved when it is back."""
    kiosks = list(
        session.scalars(
            select(KioskDevice).where(
                KioskDevice.status == KioskStatus.ACTIVE.value, KioskDevice.plant_id.in_(plant_ids)
            )
        )
    )
    alerting = status_summary(session, kiosks, now, with_alerts=True).alerts
    codes = {plant.id: plant.code for plant in session.scalars(select(Plant))}
    open_keys = set()
    for alert in alerting:
        key = f"device_offline:{alert.kiosk.id}:{alert.offline_since:%Y%m%d%H%M}"
        open_keys.add(key)
        create_notification(
            session,
            kind="device_offline",
            severity="warning",
            plant_id=alert.kiosk.plant_id,
            text_key="notification.device_offline",
            params={"plant": codes.get(alert.kiosk.plant_id, ""), "device": alert.kiosk.name},
            link="/admin/kiosks",
            dedupe_key=key,
            subject_ids=[alert.kiosk.id],
            now=now,
        )
    for notification in session.scalars(
        select(Notification).where(
            Notification.kind == "device_offline", Notification.resolved_at.is_(None)
        )
    ):
        if notification.dedupe_key not in open_keys:
            notification.resolved_at = now  # the device is back (or the shift is over)


def _still_inside(session: Session, plants: list[Plant], now: datetime) -> None:
    """F-4: people whose day still has an open IN `still_inside_alert_minutes` after the shift
    end. One notification per plant, day and shift; its count follows while it is open."""
    after = timedelta(minutes=get_int_setting(session, "still_inside_alert_minutes"))
    inside = people_inside(session, [plant.id for plant in plants], now)
    window_hours = get_int_setting(session, "attendance_window_before_hours")
    by_group: dict[tuple[uuid.UUID, date, uuid.UUID], list[uuid.UUID]] = defaultdict(list)
    if inside:
        today = to_ist(now).date()
        calendar = AttendanceCalendar.load(
            session,
            list(inside),
            today - timedelta(days=2),
            today,
            window_before_hours=window_hours,
        )
        for employee_id, item in inside.items():
            window = calendar.day_containing(employee_id, item.punch_time)
            if window is None:
                continue
            _, shift_end = shift_moments(window.day, window.shift.rules)
            if now >= shift_end + after:
                key = (item.punch.plant_id, window.day, window.shift.shift_id)
                by_group[key].append(employee_id)
    codes = {plant.id: plant.code for plant in plants}
    live_keys = set()
    for (plant_id, day, shift_id), people in by_group.items():
        key = f"still_inside:{plant_id}:{day}:{shift_id}"
        live_keys.add(key)
        params = {
            "count": len(people),
            "plant": codes.get(plant_id, ""),
            "minutes": int(after.total_seconds() // 60),
        }
        created = create_notification(
            session,
            kind="still_inside",
            severity="urgent",
            plant_id=plant_id,
            text_key="notification.still_inside",
            params=params,
            link=f"/admin/muster?plant_id={plant_id}",
            dedupe_key=key,
            subject_ids=people,
            now=now,
        )
        if created is None:
            update_open_notification(session, key, params=params, subject_ids=people)
    for notification in session.scalars(
        select(Notification).where(
            Notification.kind == "still_inside", Notification.resolved_at.is_(None)
        )
    ):
        if notification.dedupe_key not in live_keys:
            resolve_notification(session, notification.dedupe_key, now)  # nobody is left


def _many_rejections(session: Session, plant_ids: list[uuid.UUID], now: datetime) -> None:
    """At one device, at least `rejection_alert_count` refused punches (not the cool-down double
    scans, decision 0027) within `rejection_alert_minutes`. One alert per device per time slot."""
    minutes = get_int_setting(session, "rejection_alert_minutes")
    needed = get_int_setting(session, "rejection_alert_count")
    first_code = Punch.reason_codes[1]
    rows = session.execute(
        select(Punch.kiosk_id, Punch.plant_id, func.count())
        .where(
            Punch.plant_id.in_(plant_ids),
            Punch.kiosk_id.is_not(None),
            Punch.decision == PunchDecision.REJECTED.value,
            func.coalesce(first_code, "") != COOLDOWN,
            Punch.punch_time >= now - timedelta(minutes=minutes),
            Punch.punch_time <= now,
        )
        .group_by(Punch.kiosk_id, Punch.plant_id)
        .having(func.count() >= needed)
    ).all()
    codes = {plant.id: plant.code for plant in session.scalars(select(Plant))}
    slot = int(now.timestamp() // (minutes * 60))
    for kiosk_id, plant_id, count in rows:
        create_notification(
            session,
            kind="many_rejections",
            severity="warning",
            plant_id=plant_id,
            text_key="notification.many_rejections",
            params={"count": count, "plant": codes.get(plant_id, ""), "minutes": minutes},
            link="/admin/punches?decision=rejected",
            dedupe_key=f"many_rejections:{kiosk_id}:{slot}",
            subject_ids=[kiosk_id],
            now=now,
        )


# --- Every morning ------------------------------------------------------------------------------


def run_morning_alerts(session: Session, now: datetime) -> None:
    """Yesterday's incomplete days, the review digest, absence streaks, and (on the 2nd of the
    month) the register notice. Commits."""
    today = to_ist(now).date()
    yesterday = today - timedelta(days=1)
    plants = _real_plants(session)
    _incomplete_days(session, plants, yesterday, now)
    _review_digest(session, yesterday, now)
    _absence_streaks(session, plants, today, now)
    if today.day == 2:
        _monthly_register(session, plants, today, now)
    session.commit()


def _incomplete_days(session: Session, plants: list[Plant], day: date, now: datetime) -> None:
    for plant in plants:
        count = (
            session.scalar(
                select(func.count()).where(
                    AttendanceDay.plant_id == plant.id,
                    AttendanceDay.attendance_date == day,
                    AttendanceDay.status == "incomplete",
                )
            )
            or 0
        )
        if count:
            create_notification(
                session,
                kind="incomplete_days",
                severity="warning",
                plant_id=plant.id,
                text_key="notification.incomplete_days",
                params={"count": count, "plant": plant.code, "date": day.isoformat()},
                link=f"/admin/attendance?date={day}&plant_id={plant.id}&status=incomplete",
                dedupe_key=f"incomplete_days:{plant.id}:{day}",
                now=now,
            )


def _review_digest(session: Session, day: date, now: datetime) -> None:
    """The M4 digest numbers (F-48), one notice for the Super Admin."""
    digest = review_digest(session, day, now)
    flagged = sum(item.flagged for item in digest.plants)
    rejected = sum(item.rejected_with_employee for item in digest.plants)
    to_check = sum(item.to_check for item in digest.plants)
    if flagged or rejected or to_check:
        create_notification(
            session,
            kind="review_digest",
            severity="info",
            plant_id=None,
            text_key="notification.review_digest",
            params={
                "count": to_check,
                "flagged": flagged,
                "rejected": rejected,
                "date": day.isoformat(),
            },
            link="/admin/review",
            dedupe_key=f"review_digest:{day}",
            now=now,
        )


def _absence_streaks(session: Session, plants: list[Plant], today: date, now: datetime) -> None:
    """F-62: a permanent employee absent on the last `absence_streak_days` closed working days in a
    row. Leave, Short hours and Incomplete break the streak; weekly offs and holidays are not
    working days and are skipped. One notification per person per streak (decision 0036)."""
    needed = get_int_setting(session, "absence_streak_days")
    rows = session.execute(
        select(
            AttendanceDay.employee_id,
            AttendanceDay.plant_id,
            AttendanceDay.attendance_date,
            AttendanceDay.status,
        )
        .where(
            AttendanceDay.plant_id.in_([plant.id for plant in plants]),
            AttendanceDay.employee_type == "permanent",
            AttendanceDay.day_kind == "working",
            AttendanceDay.status.not_in(["open", "not_employed"]),
            AttendanceDay.attendance_date < today,
            AttendanceDay.attendance_date >= today - timedelta(days=STREAK_LOOK_BACK_DAYS),
        )
        .order_by(AttendanceDay.employee_id, AttendanceDay.attendance_date.desc())
    ).all()
    codes = {plant.id: plant.code for plant in plants}
    by_employee: dict[uuid.UUID, list[tuple[uuid.UUID, date, str]]] = defaultdict(list)
    for employee_id, plant_id, day, status in rows:
        by_employee[employee_id].append((plant_id, day, status))
    for employee_id, days in by_employee.items():
        run = 0
        for _plant, _day, status in days:
            if status != "absent":
                break
            run += 1
        if run < needed:
            continue
        plant_id, _last, _status = days[0]
        started = days[run - 1][1]
        params: dict[str, Any] = {
            "count": run,
            "plant": codes.get(plant_id, ""),
            "since": started.isoformat(),
        }
        create_notification(
            session,
            kind="absence_streak",
            severity="info",
            plant_id=plant_id,
            text_key="notification.absence_streak",
            params=params,
            link=f"/admin/employees/{employee_id}?tab=attendance",
            dedupe_key=f"absence_streak:{employee_id}:{started}",
            subject_ids=[employee_id],
            now=now,
        )


def _monthly_register(session: Session, plants: list[Plant], today: date, now: datetime) -> None:
    """F-65: on the 2nd, "the register of last month is ready" for each plant (the in-app notice;
    the attached file by email comes with the reports)."""
    last_month_end = today.replace(day=1) - timedelta(days=1)
    month = f"{last_month_end:%Y-%m}"
    for plant in plants:
        create_notification(
            session,
            kind="monthly_register",
            severity="info",
            plant_id=plant.id,
            text_key="notification.monthly_register",
            params={"month": last_month_end.strftime("%B %Y"), "plant": plant.code},
            link=f"/admin/attendance/register?month={month}&plant_id={plant.id}",
            dedupe_key=f"monthly_register:{plant.id}:{month}",
            now=now,
        )


# --- Every night --------------------------------------------------------------------------------


def purge_old_notifications(session: Session, now: datetime) -> int:
    """Alerts older than `notification_keep_days` are deleted, with their reads and deliveries.
    These are alerts, not attendance, audit or employee records. Commits."""
    cutoff = now - timedelta(days=get_int_setting(session, "notification_keep_days"))
    deleted = session.execute(
        delete(Notification).where(Notification.created_at < cutoff).returning(Notification.id)
    ).all()
    session.commit()
    return len(deleted)
