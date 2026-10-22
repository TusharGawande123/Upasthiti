"""The daily housekeeping job (spec §7 rule 10 and §8 "Retention").

1. Future-dated plant transfers take effect on their day.
2. Login sessions that ended more than 30 days ago are deleted (they are not audit records).
3. Card-punch photos past their retention are deleted from storage (M2; the rows stay).

Render's free backend sleeps, so the job also runs once at start-up and is safe to repeat:
doing it twice changes nothing the second time.
"""

import logging
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.db import get_session_factory
from app.core.storage import Storage, StorageError, get_storage
from app.core.time import IST, today_ist, utc_now
from app.modules.auth.models import LoginSession
from app.modules.employees.operations import apply_due_transfers
from app.modules.punches.retention import purge_expired_snapshots

logger = logging.getLogger(__name__)

SESSION_KEEP_DAYS = 30


def run_daily_jobs(session: Session, storage: Storage | None = None) -> dict[str, int]:
    """Do all daily work and say how much it did."""
    transfers = apply_due_transfers(session, today_ist())
    cutoff = utc_now() - timedelta(days=SESSION_KEEP_DAYS)
    old_sessions = session.scalars(
        delete(LoginSession).where(LoginSession.expires_at < cutoff).returning(LoginSession.id)
    ).all()
    session.commit()
    return {
        "transfers_applied": transfers,
        "sessions_deleted": len(old_sessions),
        "snapshots_purged": _purge_snapshots(session, storage),
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


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=IST)
    scheduler.add_job(run_daily_jobs_logged, "cron", hour=0, minute=5, id="daily")
    scheduler.start()
    return scheduler
