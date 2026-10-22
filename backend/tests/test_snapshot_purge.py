"""The daily purge of expired photos (spec M2 §7 rule 15, AC-22). Real PostgreSQL and a real
local storage folder; fake data."""

import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.storage import LocalStorage, Storage, StorageError
from app.core.time import utc_now
from app.jobs.daily import run_daily_jobs
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.punches.retention import purge_expired_snapshots


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path / "files")


@pytest.fixture
def kiosk(db_session: Session) -> KioskDevice:
    plant = Plant(name="Plant K134", code="K134")
    db_session.add(plant)
    db_session.flush()
    device = KioskDevice(plant_id=plant.id, name="Gate", status="active")
    db_session.add(device)
    db_session.commit()
    return device


def add_photo(
    session: Session,
    kiosk: KioskDevice,
    storage: Storage,
    *,
    expires_in: timedelta,
    state: str = "stored",
) -> PunchSnapshot:
    """A rejected punch with a photo. A real file exists for `stored`, and also for
    `upload_failed`: an upload that timed out may still have written its file."""
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        method="qr",
        decision="rejected",
        reason_codes=["QR_FORMAT_INVALID"],
        server_received_at=utc_now(),
    )
    session.add(punch)
    session.flush()
    key = f"snapshots/2026/10/20/{punch.id}.bin"
    if state in ("stored", "upload_failed"):
        storage.save(key, b"encrypted bytes")
    now = utc_now()
    snapshot = PunchSnapshot(
        punch_id=punch.id,
        storage_key=key,
        size_bytes=15 if state == "stored" else 0,
        width=320,
        height=240,
        brightness=100,
        is_dark=False,
        taken_at=now - timedelta(days=61),
        expires_at=now + expires_in,
        state=state,
    )
    session.add(snapshot)
    session.commit()
    return snapshot


def file_exists(storage: LocalStorage, snapshot: PunchSnapshot) -> bool:
    try:
        storage.read(snapshot.storage_key)
    except StorageError:
        return False
    return True


def count_punches(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Punch)) or 0


def test_expired_photos_lose_their_file_but_keep_their_rows(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    expired = add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-1))
    still_valid = add_photo(db_session, kiosk, storage, expires_in=timedelta(days=5))
    punches_before = count_punches(db_session)

    purged = purge_expired_snapshots(db_session, storage, utc_now())

    assert purged == 1
    db_session.refresh(expired)
    db_session.refresh(still_valid)
    assert expired.state == "purged" and expired.purged_at is not None
    assert not file_exists(storage, expired)
    assert still_valid.state == "stored" and file_exists(storage, still_valid)
    assert count_punches(db_session) == punches_before  # punches are never touched


def test_a_photo_is_kept_up_to_its_expiry_time_and_purged_just_after(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    photo = add_photo(db_session, kiosk, storage, expires_in=timedelta(days=1))
    expiry = photo.expires_at

    assert purge_expired_snapshots(db_session, storage, expiry) == 0
    assert purge_expired_snapshots(db_session, storage, expiry + timedelta(seconds=1)) == 1


def test_running_it_twice_changes_nothing_the_second_time(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-1))

    assert purge_expired_snapshots(db_session, storage, utc_now()) == 1
    assert purge_expired_snapshots(db_session, storage, utc_now()) == 0


def test_many_photos_are_purged_in_batches(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    photos = [
        add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-1)) for _ in range(5)
    ]

    purged = purge_expired_snapshots(db_session, storage, utc_now(), batch_size=2)

    assert purged == 5
    assert not any(file_exists(storage, photo) for photo in photos)
    still_stored = db_session.scalar(
        select(func.count()).select_from(PunchSnapshot).where(PunchSnapshot.state == "stored")
    )
    assert still_stored == 0


def test_a_photo_whose_upload_failed_is_deleted_and_marked_purged_after_its_retention(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    old = add_photo(
        db_session, kiosk, storage, expires_in=timedelta(days=-1), state="upload_failed"
    )
    recent = add_photo(
        db_session, kiosk, storage, expires_in=timedelta(days=3), state="upload_failed"
    )

    assert purge_expired_snapshots(db_session, storage, utc_now()) == 1

    db_session.refresh(old)
    db_session.refresh(recent)
    assert old.state == "purged" and old.purged_at is not None
    assert recent.state == "upload_failed"
    # The file that a timed-out upload may have left behind is gone too (DPDP retention).
    with pytest.raises(StorageError):
        storage.read(old.storage_key)
    assert storage.read(recent.storage_key) == b"encrypted bytes"


class FailingStorage:
    def save(self, key: str, data: bytes) -> None:
        raise StorageError("down")

    def read(self, key: str) -> bytes:
        raise StorageError("down")

    def delete(self, keys: list[str]) -> None:
        raise StorageError("down")


def test_a_failed_delete_leaves_the_rows_for_the_next_run(
    db_session: Session,
    kiosk: KioskDevice,
    storage: LocalStorage,
    caplog: pytest.LogCaptureFixture,
) -> None:
    photo = add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-1))

    purged = purge_expired_snapshots(db_session, FailingStorage(), utc_now())

    assert purged == 0
    db_session.refresh(photo)
    assert photo.state == "stored" and file_exists(storage, photo)
    assert "Snapshot purge stopped" in caplog.text
    assert "Snapshot could not be deleted" in caplog.text
    # The next run, with working storage, finishes the job.
    assert purge_expired_snapshots(db_session, storage, utc_now()) == 1


class OneBadKeyStorage:
    """A storage that refuses any batch holding the bad key, and the bad key alone."""

    def __init__(self, real: LocalStorage, bad_key: str, error: Exception) -> None:
        self.real, self.bad_key, self.error = real, bad_key, error

    def save(self, key: str, data: bytes) -> None:
        self.real.save(key, data)

    def read(self, key: str) -> bytes:
        return self.real.read(key)

    def delete(self, keys: list[str]) -> None:
        if self.bad_key in keys:
            raise self.error
        self.real.delete(keys)


@pytest.mark.parametrize("error", [StorageError("refused"), ValueError("key not allowed")])
def test_one_failing_key_in_the_first_batch_does_not_stop_the_other_photos(
    db_session: Session,
    kiosk: KioskDevice,
    storage: LocalStorage,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
) -> None:
    photos = [
        add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-day)) for day in (5, 4, 3)
    ]
    bad = photos[0]  # the oldest, so it sits in the first batch of two
    flaky = OneBadKeyStorage(storage, bad.storage_key, error)

    purged = purge_expired_snapshots(db_session, flaky, utc_now(), batch_size=2)

    assert purged == 2
    for photo in photos:
        db_session.refresh(photo)
    assert bad.state == "stored" and file_exists(storage, bad)  # never purged before deleted
    assert [photo.state for photo in photos[1:]] == ["purged", "purged"]
    assert not any(file_exists(storage, photo) for photo in photos[1:])
    logged = [r.fields for r in caplog.records if hasattr(r, "fields")]  # type: ignore[attr-defined]
    assert logged == [{"punch_id": str(bad.punch_id)}]
    assert bad.storage_key not in caplog.text and bad.storage_key not in str(logged)
    # Once the key works again, the next run takes the skipped photo too.
    assert purge_expired_snapshots(db_session, storage, utc_now()) == 1


def test_the_daily_job_runs_the_purge_and_reports_how_many(
    db_session: Session, kiosk: KioskDevice, storage: LocalStorage
) -> None:
    add_photo(db_session, kiosk, storage, expires_in=timedelta(days=-1))

    assert run_daily_jobs(db_session, storage)["snapshots_purged"] == 1
    assert run_daily_jobs(db_session, storage)["snapshots_purged"] == 0


def test_a_storage_problem_skips_the_purge_but_not_the_other_daily_work(
    db_session: Session, kiosk: KioskDevice, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_storage() -> Storage:
        raise StorageError("Supabase storage needs SUPABASE_URL and SUPABASE_SERVICE_KEY.")

    monkeypatch.setattr("app.jobs.daily.get_storage", no_storage)

    result = run_daily_jobs(db_session)

    assert result["snapshots_purged"] == 0
    assert result["transfers_applied"] == 0
