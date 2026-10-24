"""Removes face data that has outlived its time (spec M3 §7 rule 12). Safe to run again and again.

Runs every 5 minutes and at start-up (app/jobs/daily.py). Each new enrolment session also
cleans its own employee's old rows first, so no shot embedding outlives its 2 hours (decision
0018) even if the scheduler is switched off. The job logs only counts, never what was deleted.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.face.models import EnrolmentState, FaceEnrolmentSession, FaceEnrolmentShot
from app.modules.punches.models import FacePendingMatch, PunchChallenge


def expire_old_sessions(
    session: Session, now: datetime, employee_id: uuid.UUID | None = None
) -> int:
    """Open sessions past their end become "expired" and lose their shots. Caller commits."""
    statement = select(FaceEnrolmentSession.id).where(
        FaceEnrolmentSession.state == EnrolmentState.OPEN.value,
        FaceEnrolmentSession.expires_at <= now,
    )
    if employee_id is not None:
        statement = statement.where(FaceEnrolmentSession.employee_id == employee_id)
    old_ids = list(session.scalars(statement))
    if not old_ids:
        return 0
    session.execute(delete(FaceEnrolmentShot).where(FaceEnrolmentShot.session_id.in_(old_ids)))
    session.execute(
        update(FaceEnrolmentSession)
        .where(FaceEnrolmentSession.id.in_(old_ids))
        .values(state=EnrolmentState.EXPIRED.value)
    )
    return len(old_ids)


def run_face_cleanup(session: Session) -> dict[str, int]:
    now = utc_now()
    pending = session.execute(delete(FacePendingMatch).where(FacePendingMatch.expires_at < now))
    challenges = session.execute(
        delete(PunchChallenge).where(PunchChallenge.issued_at < now - timedelta(days=1))
    )
    counts = {
        "enrolment_sessions_expired": expire_old_sessions(session, now),
        "pending_matches_deleted": pending.rowcount,  # type: ignore[attr-defined]
        "challenges_deleted": challenges.rowcount,  # type: ignore[attr-defined]
    }
    session.commit()
    return counts
