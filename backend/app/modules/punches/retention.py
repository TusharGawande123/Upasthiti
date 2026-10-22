"""How long card-punch photos are kept (spec M2 §7 rules 4 and 15).

- Lowering `snapshot_retention_days` moves the expiry of photos that are already stored back.
- The daily purge deletes the files of photos past their expiry and marks the rows `purged`.
The punch rows and the photo rows themselves are never deleted.
"""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.storage import Storage, StorageError
from app.modules.punches.models import PunchSnapshot, SnapshotState

# `upload_failed` is included on purpose: a timed-out upload may still have written the file.
KEPT_STATES = (SnapshotState.STORED.value, SnapshotState.UPLOAD_FAILED.value)


def shorten_snapshot_expiry(session: Session, retention_days: int) -> int:
    """Move later expiry dates back to `taken_at + retention_days`. Returns how many changed."""
    new_expiry = PunchSnapshot.taken_at + timedelta(days=retention_days)
    result = session.execute(
        update(PunchSnapshot)
        .where(
            PunchSnapshot.state.in_(KEPT_STATES),
            PunchSnapshot.expires_at > new_expiry,
        )
        .values(expires_at=new_expiry, updated_at=func.now())
    )
    return result.rowcount  # pyright: ignore[reportAttributeAccessIssue]


# --- The daily purge ----------------------------------------------------------------------------

logger = logging.getLogger(__name__)

PURGE_BATCH_SIZE = 500


def purge_expired_snapshots(
    session: Session, storage: Storage, now: datetime, batch_size: int = PURGE_BATCH_SIZE
) -> int:
    """Delete the files of photos past their expiry, and mark their rows `purged`.

    Only the file and the state change: the punch and the snapshot row stay for the records.
    A photo marked `upload_failed` is deleted too: the upload may have timed out after the
    storage had already saved the file, and deleting a file that is not there is not an error.
    Safe to repeat. If a batch delete fails, the photos of that batch are deleted one by one,
    so a single bad key cannot block the others; a photo that still fails is skipped (and left
    for the next run). A row is marked `purged` only after its file is really deleted.
    The run stops early only when a whole batch failed (the storage is probably down).
    Returns how many photos were purged.
    """
    purged = 0
    skipped_ids: set[uuid.UUID] = set()
    while True:
        due = list(
            session.scalars(
                select(PunchSnapshot)
                .where(
                    PunchSnapshot.state.in_(KEPT_STATES),
                    PunchSnapshot.expires_at < now,
                    PunchSnapshot.id.not_in(skipped_ids),
                )
                .order_by(PunchSnapshot.expires_at, PunchSnapshot.id)
                .limit(batch_size)
            )
        )
        if not due:
            return purged
        deleted = _delete_files(storage, due, skipped_ids)
        for row in deleted:
            row.state = SnapshotState.PURGED.value
            row.purged_at = now
        session.commit()  # after each batch, so a crash loses at most one batch of work
        purged += len(deleted)
        if not deleted:
            logger.error("Snapshot purge stopped: no file of a whole batch could be deleted")
            return purged


def _delete_files(
    storage: Storage, rows: list[PunchSnapshot], skipped_ids: set[uuid.UUID]
) -> list[PunchSnapshot]:
    """The rows whose file is gone. Tries the whole batch first, then key by key."""
    try:
        storage.delete([row.storage_key for row in rows])
        return rows
    except StorageError, ValueError:
        logger.warning("Snapshot batch delete failed, trying one photo at a time")
    deleted: list[PunchSnapshot] = []
    for row in rows:
        try:
            storage.delete([row.storage_key])
            deleted.append(row)
        except StorageError, ValueError:
            # The punch id is enough to find the photo; the key itself is never logged.
            logger.error(
                "Snapshot could not be deleted", extra={"fields": {"punch_id": str(row.punch_id)}}
            )
            skipped_ids.add(row.id)
    return deleted
