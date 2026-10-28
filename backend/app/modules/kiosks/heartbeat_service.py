"""What the gate's 60-second heartbeat does on the server (M4 spec §5.2, §7 rules 15, 16, 20).

It updates the status columns of the device (queue, location, storage, battery, camera) in place,
and writes a small health sample (F-3) when the last one is 5 minutes old or the location or
camera state changed. It stores no coordinates in the samples and never contents of the queue.
"""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.kiosks.models import KioskDevice, KioskHeartbeat, LocationState

SAMPLE_EVERY = timedelta(minutes=5)
KEEP_SAMPLES_DAYS = 7


class HeartbeatQueue(BaseModel):
    count: int = Field(ge=0, le=100_000)
    bytes: int = Field(ge=0, le=2**40)
    # The device's own estimate of when its oldest saved punch was made: informational only.
    oldest_punch_at: datetime | None = None


class HeartbeatLocation(BaseModel):
    state: LocationState
    lat: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    lon: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float | None = Field(default=None, ge=0, le=99_999, allow_inf_nan=False)
    age_s: int | None = Field(default=None, ge=0, le=604_800)


class HeartbeatStorage(BaseModel):
    persisted: bool | None = None
    quota_mb: int | None = Field(default=None, ge=0, le=100_000_000)
    usage_mb: int | None = Field(default=None, ge=0, le=100_000_000)
    offline_ready: bool = False  # S-38: enough room for a full queue


class HeartbeatBattery(BaseModel):
    level: float = Field(ge=0, le=1, allow_inf_nan=False)
    charging: bool


class HeartbeatRequest(BaseModel):
    queue: HeartbeatQueue
    location: HeartbeatLocation
    storage: HeartbeatStorage
    battery: HeartbeatBattery | None = None
    camera_ok: bool | None = None
    app_version: str | None = Field(default=None, max_length=40)


def _decimal(value: float | None, places: int) -> Decimal | None:
    return None if value is None else Decimal(f"{value:.{places}f}")


def record_heartbeat(
    session: Session, kiosk: KioskDevice, report: HeartbeatRequest, now: datetime
) -> None:
    previous_location = kiosk.location_state
    previous_camera = kiosk.camera_ok

    kiosk.last_heartbeat_at = now
    kiosk.queue_count = report.queue.count
    kiosk.queue_bytes = report.queue.bytes
    kiosk.queue_oldest_at = report.queue.oldest_punch_at if report.queue.count else None
    kiosk.location_state = report.location.state.value
    if report.location.lat is not None and report.location.lon is not None:
        kiosk.last_lat = _decimal(report.location.lat, 6)
        kiosk.last_lon = _decimal(report.location.lon, 6)
        kiosk.last_accuracy_m = _decimal(report.location.accuracy_m, 1)
        kiosk.last_location_at = now
    kiosk.storage_persisted = report.storage.persisted
    kiosk.storage_quota_mb = report.storage.quota_mb
    kiosk.storage_usage_mb = report.storage.usage_mb
    kiosk.offline_ready = report.storage.offline_ready
    kiosk.battery_level = _decimal(report.battery.level, 2) if report.battery else None
    kiosk.battery_charging = report.battery.charging if report.battery else None
    kiosk.camera_ok = report.camera_ok
    if report.app_version:
        kiosk.app_version = report.app_version

    changed = previous_location != kiosk.location_state or previous_camera != kiosk.camera_ok
    if changed or _last_sample_is_old(session, kiosk.id, now):
        session.add(
            KioskHeartbeat(
                kiosk_id=kiosk.id,
                received_at=now,
                queue_count=report.queue.count,
                location_state=kiosk.location_state,
                accuracy_m=_decimal(report.location.accuracy_m, 1),
                battery_level=kiosk.battery_level,
                battery_charging=kiosk.battery_charging,
                camera_ok=kiosk.camera_ok,
                storage_usage_mb=report.storage.usage_mb,
                app_version=kiosk.app_version,
            )
        )
    session.commit()


def _last_sample_is_old(session: Session, kiosk_id: uuid.UUID, now: datetime) -> bool:
    newest = session.scalar(
        select(KioskHeartbeat.received_at)
        .where(KioskHeartbeat.kiosk_id == kiosk_id)
        .order_by(KioskHeartbeat.received_at.desc())
        .limit(1)
    )
    return newest is None or now - newest >= SAMPLE_EVERY
