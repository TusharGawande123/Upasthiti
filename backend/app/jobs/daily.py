"""The daily housekeeping job (spec §7 rule 10 and §8 "Retention").

1. Future-dated plant transfers take effect on their day.
2. Login sessions that ended more than 30 days ago are deleted (they are not audit records).
3. Card-punch photos past their retention are deleted from storage (M2; the rows stay).
4. Shift rule versions that start today are copied into the shift row (M5, decision 0036).
A second job removes short-lived face data every 5 minutes (M3, app/modules/face/cleanup.py).
M5 adds two scheduled jobs of their own, because they can be long and must not slow a cold
start: the nightly close of the attendance days (00:05 IST, and once after start-up) and the
5-minute catch-up that recomputes stale days (app/modules/attendance/service.py).

Render's free backend sleeps, so the job also runs once at start-up and is safe to repeat:
doing it twice changes nothing the second time.
"""

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db import get_session_factory
from app.core.storage import Storage, StorageError, get_storage
from app.core.time import IST, today_ist, utc_now
from app.modules.attendance.service import close_recent_days, recompute_stale
from app.modules.auth.models import LoginSession
from app.modules.employees.operations import apply_due_transfers
from app.modules.face.cleanup import run_face_cleanup
from app.modules.kiosks.heartbeat_service import KEEP_SAMPLES_DAYS
from app.modules.kiosks.models import KioskHeartbeat
from app.modules.org.shift_rules_service import apply_due_rule_versions
from app.modules.punches.retention import purge_expired_snapshots

logger = logging.getLogger(__name__)

SESSION_KEEP_DAYS = 30


def purge_old_heartbeats(session: Session, now: datetime, batch_size: int = 5000) -> int:
    """Delete attendance device health samples older than 7 days (F-3, spec M4 §7 rule 20), in
    batches so one run never holds the table for long. These are health samples, not attendance,
    audit or employee records. Safe to repeat."""
    cutoff = now - timedelta(days=KEEP_SAMPLES_DAYS)
    total = 0
    while True:
        old_ids = session.scalars(
            select(KioskHeartbeat.id).where(KioskHeartbeat.received_at < cutoff).limit(batch_size)
        ).all()
        if not old_ids:
            return total
        session.execute(delete(KioskHeartbeat).where(KioskHeartbeat.id.in_(old_ids)))
        session.commit()
        total += len(old_ids)


def run_daily_jobs(session: Session, storage: Storage | None = None) -> dict[str, int]:
    """Do all daily work and say how much it did."""
    transfers = apply_due_transfers(session, today_ist())
    shift_rules = apply_due_rule_versions(session, today_ist())
    cutoff = utc_now() - timedelta(days=SESSION_KEEP_DAYS)
    old_sessions = session.scalars(
        delete(LoginSession).where(LoginSession.expires_at < cutoff).returning(LoginSession.id)
    ).all()
    session.commit()
    return {
        "transfers_applied": transfers,
        "shift_rules_applied": shift_rules,
        "sessions_deleted": len(old_sessions),
        "snapshots_purged": _purge_snapshots(session, storage),
        "heartbeats_deleted": purge_old_heartbeats(session, utc_now()),
    }


def _purge_snapshots(session: Session, storage: Storage | None) -> int:
    """The photo purge never stops the other daily work: a storage problem only skips it."""
    try:
        return purge_expired_snapshots(session, storage or get_storage(), utc_now())
    except StorageError:
        logger.exception("Snapshot purge skipped: the storage is not available")
        return 0


def run_daily_jobs_logged() -> None:
    try:
        with get_session_factory()() as session:
            logger.info("Daily jobs finished", extra={"fields": run_daily_jobs(session)})
    except Exception:
        # The next run (tomorrow, or at the next start) tries again.
        logger.exception("Daily jobs failed")


def run_face_cleanup_logged() -> None:
    try:
        with get_session_factory()() as session:
            counts = run_face_cleanup(session)
        if any(counts.values()):
            logger.info("Face cleanup finished", extra={"fields": counts})
    except Exception:
        logger.exception("Face cleanup failed")


def run_attendance_catch_up_logged() -> None:
    """Recompute stale attendance days, batch after batch, until none are left (M5 rule 14)."""
    try:
        with get_session_factory()() as session:
            total = 0
            while True:
                done = recompute_stale(session, utc_now())
                total += done
                if done == 0:
                    break
            if total:
                logger.info("Attendance catch-up finished", extra={"fields": {"days": total}})
    except Exception:
        logger.exception("Attendance catch-up failed")


def run_attendance_close_logged() -> None:
    """Every active employee gets a stored day for each of the last days (M5 rule 14 c)."""
    try:
        with get_session_factory()() as session:
            days = close_recent_days(session, utc_now())
        logger.info("Attendance close finished", extra={"fields": {"days": days}})
    except Exception:
        logger.exception("Attendance close failed")


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=IST)
    scheduler.add_job(run_daily_jobs_logged, "cron", hour=0, minute=5, id="daily")
    # Runs at once (catch up after a sleep), then every 5 minutes.
    scheduler.add_job(
        run_face_cleanup_logged, "interval", minutes=5, id="face-cleanup", next_run_time=utc_now()
    )
    # Also at once, then every 5 minutes. `next_run_time`, not a call at start-up, so a Render
    # cold start does not wait for it.
    scheduler.add_job(
        run_attendance_catch_up_logged,
        "interval",
        minutes=5,
        id="attendance-catch-up",
        next_run_time=utc_now(),
    )
    scheduler.add_job(run_attendance_close_logged, "cron", hour=0, minute=5, id="attendance-close")
    # Once after start-up too: days missed while the free server slept are closed.
    scheduler.add_job(
        run_attendance_close_logged,
        "date",
        run_date=utc_now() + timedelta(seconds=30),
        id="attendance-close-at-start",
    )
    scheduler.start()
    return scheduler
