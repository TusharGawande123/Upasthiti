"""Keeping photos no longer than the retention setting (spec M2 §7 rule 4).

When the Super Admin LOWERS `snapshot_retention_days`, photos that are already stored must not
outlive the new period. Only their expiry date moves; the daily purge then deletes the files.
"""

from datetime import timedelta

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from app.modules.punches.models import PunchSnapshot, SnapshotState


def shorten_snapshot_expiry(session: Session, retention_days: int) -> int:
    """Move later expiry dates back to `taken_at + retention_days`. Returns how many changed."""
    new_expiry = PunchSnapshot.taken_at + timedelta(days=retention_days)
    result = session.execute(
        update(PunchSnapshot)
        .where(
            PunchSnapshot.state == SnapshotState.STORED.value,
            PunchSnapshot.expires_at > new_expiry,
        )
        .values(expires_at=new_expiry, updated_at=func.now())
    )
    return result.rowcount  # pyright: ignore[reportAttributeAccessIssue]
