"""Which gate notices a kiosk shows right now (spec M2 §7 rule 11)."""

import uuid
from datetime import datetime

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.modules.notices.models import KioskNotice, NoticeLevel

MAX_NOTICES_ON_KIOSK = 3


def visible_notices(session: Session, plant_id: uuid.UUID, now: datetime) -> list[KioskNotice]:
    """Notices for this plant or for all plants, started, not over and not ended by hand.

    At most three: important ones first, then the newest start.
    """
    important_first = case((KioskNotice.level == NoticeLevel.IMPORTANT.value, 0), else_=1)
    return list(
        session.scalars(
            select(KioskNotice)
            .where(
                or_(KioskNotice.plant_id == plant_id, KioskNotice.plant_id.is_(None)),
                KioskNotice.starts_at <= now,
                KioskNotice.ends_at > now,
                KioskNotice.ended_at.is_(None),
            )
            .order_by(important_first, KioskNotice.starts_at.desc(), KioskNotice.id)
            .limit(MAX_NOTICES_ON_KIOSK)
        )
    )
