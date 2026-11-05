"""The morning bell notice for data requests that are due soon (M6 spec 7.7 rule 5).

Called by the 07:00 alert job. One notice 5 days before the due day and one on the due day,
for the Super Admin only (they are not in the heads' list of kinds). The notice holds the due
day and the days left, never a name; the dedupe key is per request and day, so the job can run
again and again without a second notice. An overdue request stays in the screen's banner.
"""

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.data_requests.models import DataRequest, DataRequestEvent
from app.modules.data_requests.service import DUE_SOON_DAYS
from app.modules.notifications.service import create_notification

NOTICE_DAYS_BEFORE = (DUE_SOON_DAYS, 0)


def raise_due_notices(session: Session, today: date, now: datetime) -> int:
    """Make the notices of today; returns how many were new. The caller commits."""
    made = 0
    for request in _open_requests_due_in(session, today):
        days_left = (request.due_on - today).days
        notice = create_notification(
            session,
            kind="data_request_due",
            severity="urgent" if days_left == 0 else "warning",
            plant_id=None,
            text_key="notification.data_request_due",
            params={"due_on": request.due_on.isoformat(), "days": days_left},
            link="/admin/privacy-requests",
            dedupe_key=f"data_request_due:{request.id}:{today.isoformat()}",
            subject_ids=[request.id],
            now=now,
        )
        made += notice is not None
    return made


def _open_requests_due_in(session: Session, today: date) -> list[DataRequest]:
    """Requests with no closing step whose due day is 5 days away or today."""
    closed = select(DataRequestEvent.data_request_id).where(DataRequestEvent.event_type == "closed")
    due_days = [today + timedelta(days=days) for days in NOTICE_DAYS_BEFORE]
    return list(
        session.scalars(
            select(DataRequest)
            .where(DataRequest.due_on.in_(due_days), DataRequest.id.not_in(closed))
            .order_by(DataRequest.due_on.desc(), DataRequest.id)
        )
    )
