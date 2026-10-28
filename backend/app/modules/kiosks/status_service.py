"""Device status for the admin: the list fields, the offline badge and alert, and the 7-day health
timeline (M4 spec §4.7, §5.4, §7 rules 15 and 20; F-3, F-36, F-46).

Everything here is computed when it is asked for. Nothing is stored except the heartbeat samples.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST, to_ist
from app.modules.kiosks.heartbeat_service import KEEP_SAMPLES_DAYS
from app.modules.kiosks.models import KioskDevice, KioskHeartbeat, KioskStatus
from app.modules.kiosks.schemas import (
    BatteryInfo,
    KioskResponse,
    LocationInfo,
    QueueInfo,
    StorageInfo,
)
from app.modules.kiosks.status import (
    DeviceState,
    device_state,
    offline_after_minutes,
)
from app.modules.org.geofence import distance_to_geofence_m
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Plant, Shift
from app.modules.settings.service import get_int_setting


def kiosk_view(
    session: Session, kiosk: KioskDevice, now: datetime, *, show_position: bool
) -> KioskResponse:
    """The list row of one device: its facts plus the state worked out now."""
    base = KioskResponse.from_model(kiosk)
    state = device_state(kiosk, now, offline_after_minutes(session))
    has_heartbeat = kiosk.last_heartbeat_at is not None
    return base.model_copy(
        update={
            "state": state.value,
            "last_contact_at": kiosk.last_seen_at,
            "last_punch_at": kiosk.last_punch_at,
            "last_sync_at": kiosk.last_sync_at,
            "queue": (
                QueueInfo(
                    count=kiosk.queue_count,
                    bytes=kiosk.queue_bytes,
                    oldest_punch_at=kiosk.queue_oldest_at,
                )
                if has_heartbeat
                else None
            ),
            "location": _location_info(session, kiosk, show_position) if has_heartbeat else None,
            "storage": (
                StorageInfo(
                    persisted=kiosk.storage_persisted,
                    quota_mb=kiosk.storage_quota_mb,
                    usage_mb=kiosk.storage_usage_mb,
                    offline_ready=kiosk.offline_ready,
                )
                if has_heartbeat
                else None
            ),
            "battery": (
                BatteryInfo(level=float(kiosk.battery_level), charging=kiosk.battery_charging)
                if kiosk.battery_level is not None
                else None
            ),
            "camera_ok": kiosk.camera_ok,
        }
    )


def _location_info(session: Session, kiosk: KioskDevice, show_position: bool) -> LocationInfo:
    lat = float(kiosk.last_lat) if kiosk.last_lat is not None else None
    lon = float(kiosk.last_lon) if kiosk.last_lon is not None else None
    inside = None
    fence = current_geofence(session, kiosk.plant_id)
    if fence is not None and lat is not None and lon is not None:
        distance = distance_to_geofence_m(fence.shape, fence.geojson, fence.radius_m, lon, lat)
        inside = (
            "inside" if distance == 0 else ("edge" if distance <= fence.buffer_m else "outside")
        )
    return LocationInfo(
        state=kiosk.location_state,
        accuracy_m=float(kiosk.last_accuracy_m) if kiosk.last_accuracy_m is not None else None,
        at=kiosk.last_location_at,
        inside=inside,
        lat=round(lat, 5) if show_position and lat is not None else None,
        lon=round(lon, 5) if show_position and lon is not None else None,
    )


@dataclass(frozen=True)
class OfflineAlert:
    kiosk: KioskDevice
    plant: Plant
    offline_since: datetime


@dataclass(frozen=True)
class StatusSummary:
    online: int
    offline: int
    needs_location: int
    sending: int
    alerts: list[OfflineAlert]


def status_summary(
    session: Session,
    kiosks: list[KioskDevice],
    now: datetime,
    *,
    with_alerts: bool,
) -> StatusSummary:
    """Counts for the badge and the dashboard card, and the offline alerts (F-36, F-46).

    An alert needs: an active device, offline for `kiosk_offline_alert_minutes`, and the current
    IST time inside one of its plant's active shifts. Nothing is stored."""
    after = offline_after_minutes(session)
    alert_after = timedelta(minutes=get_int_setting(session, "kiosk_offline_alert_minutes"))
    counts = {state: 0 for state in DeviceState}
    alerts: list[OfflineAlert] = []
    for kiosk in kiosks:
        state = device_state(kiosk, now, after)
        counts[state] += 1
        if (
            with_alerts
            and state is DeviceState.OFFLINE
            and kiosk.last_seen_at is not None
            and now - kiosk.last_seen_at >= alert_after
            and _in_shift(session, kiosk.plant_id, now)
        ):
            plant = session.get(Plant, kiosk.plant_id)
            if plant is not None:
                alerts.append(OfflineAlert(kiosk, plant, kiosk.last_seen_at))
    return StatusSummary(
        online=counts[DeviceState.ONLINE],
        offline=counts[DeviceState.OFFLINE],
        needs_location=counts[DeviceState.NEEDS_LOCATION],
        sending=counts[DeviceState.SENDING],
        alerts=alerts,
    )


def active_kiosks(
    session: Session, only_plant_ids: frozenset[uuid.UUID] | None
) -> list[KioskDevice]:
    statement = select(KioskDevice).where(KioskDevice.status == KioskStatus.ACTIVE.value)
    if only_plant_ids is not None:
        statement = statement.where(KioskDevice.plant_id.in_(only_plant_ids))
    return list(session.scalars(statement.order_by(KioskDevice.name)))


# --- Shifts ------------------------------------------------------------------------------------


def shift_windows(
    session: Session, plant_id: uuid.UUID, day: date
) -> list[tuple[datetime, datetime]]:
    """The plant's active shifts on an IST day as (start, end) moments. A night shift belongs to
    its start day and ends the next morning (SRS §8)."""
    windows = []
    for shift in session.scalars(
        select(Shift).where(Shift.plant_id == plant_id, Shift.is_active.is_(True))
    ):
        start = datetime.combine(day, shift.start_time, tzinfo=IST)
        end_day = day + timedelta(days=1) if shift.end_time <= shift.start_time else day
        end = datetime.combine(end_day, shift.end_time, tzinfo=IST)
        windows.append((start, end))
    return windows


def _in_shift(session: Session, plant_id: uuid.UUID, now: datetime) -> bool:
    today = to_ist(now).date()
    # Yesterday's night shift may still be running this morning.
    for day in (today - timedelta(days=1), today):
        for start, end in shift_windows(session, plant_id, day):
            if start <= now < end:
                return True
    return False


# --- The 7-day timeline (F-3) --------------------------------------------------------------------


@dataclass(frozen=True)
class Stretch:
    start: datetime
    end: datetime
    state: str  # "online" or "offline"


@dataclass(frozen=True)
class DayHealth:
    day: date
    online_minutes: int
    offline_minutes: int
    shift_minutes: int
    stretches: list[Stretch]


def _stretches(
    samples: list[datetime], window_start: datetime, window_end: datetime, gap: timedelta
) -> list[Stretch]:
    """Online while samples follow each other within `gap`; offline in every longer silence.

    The first sample is at most `gap` after the start of the window for the device to count as
    online before it, and the same after the last sample."""
    stretches: list[Stretch] = []

    def add(start: datetime, end: datetime, state: str) -> None:
        start, end = max(start, window_start), min(end, window_end)
        if end <= start:
            return
        if stretches and stretches[-1].state == state and stretches[-1].end == start:
            stretches[-1] = Stretch(stretches[-1].start, end, state)
        else:
            stretches.append(Stretch(start, end, state))

    inside = [moment for moment in samples if window_start - gap <= moment <= window_end + gap]
    if not inside:
        add(window_start, window_end, "offline")
        return stretches
    cursor = window_start
    for moment in inside:
        if moment - cursor > gap:
            add(cursor, moment - gap, "offline")  # silence up to the moment it came back
            cursor = moment - gap
        add(cursor, moment, "online")
        cursor = max(cursor, moment)
    if window_end - cursor > gap:
        add(cursor, cursor + gap, "online")
        add(cursor + gap, window_end, "offline")
    else:
        add(cursor, window_end, "online")
    return stretches


def health_days(
    session: Session, kiosk: KioskDevice, now: datetime, days: int
) -> tuple[list[DayHealth], KioskHeartbeat | None]:
    """Per IST day (newest last): online and offline minutes, the minutes inside shifts and the
    online / offline stretches, worked out from the gaps between health samples."""
    gap = timedelta(minutes=offline_after_minutes(session) + 5)
    today = to_ist(now).date()
    first_day = today - timedelta(days=days - 1)
    window_from = datetime.combine(first_day, time.min, tzinfo=IST)
    samples = list(
        session.scalars(
            select(KioskHeartbeat.received_at)
            .where(
                KioskHeartbeat.kiosk_id == kiosk.id,
                KioskHeartbeat.received_at >= window_from - gap,
            )
            .order_by(KioskHeartbeat.received_at)
        )
    )
    # The device's own contact time also counts: it is newer than the last sample.
    if kiosk.last_seen_at is not None:
        samples.append(kiosk.last_seen_at)
    samples = sorted(set(samples))
    registered = kiosk.registered_at
    result = []
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        start = datetime.combine(day, time.min, tzinfo=IST)
        end = min(start + timedelta(days=1), now)
        if registered is not None:
            start = max(start, registered)
        if end <= start:
            result.append(DayHealth(day, 0, 0, 0, []))
            continue
        stretches = _stretches(samples, start, end, gap)
        online = sum((s.end - s.start).total_seconds() for s in stretches if s.state == "online")
        offline = sum((s.end - s.start).total_seconds() for s in stretches if s.state == "offline")
        shift_minutes = _shift_minutes(session, kiosk.plant_id, day, end)
        result.append(
            DayHealth(day, round(online / 60), round(offline / 60), shift_minutes, stretches)
        )
    latest = session.scalar(
        select(KioskHeartbeat)
        .where(KioskHeartbeat.kiosk_id == kiosk.id)
        .order_by(KioskHeartbeat.received_at.desc())
        .limit(1)
    )
    return result, latest


def _shift_minutes(session: Session, plant_id: uuid.UUID, day: date, until: datetime) -> int:
    total = 0.0
    for start, end in shift_windows(session, plant_id, day):
        total += max(0.0, (min(end, until) - start).total_seconds())
    return round(total / 60)


def _minutes_in_shifts(
    session: Session, plant_id: uuid.UUID, day: date, stretches: list[Stretch], state: str
) -> int:
    """Minutes of the stretches in `state` that fall inside the plant's shifts that day."""
    total = 0.0
    for shift_start, shift_end in shift_windows(session, plant_id, day):
        for stretch in stretches:
            if stretch.state != state:
                continue
            overlap = min(stretch.end, shift_end) - max(stretch.start, shift_start)
            total += max(0.0, overlap.total_seconds())
    return round(total / 60)


def offline_minutes_in_shifts(
    session: Session, kiosk: KioskDevice, day: date, now: datetime
) -> int:
    """Minutes the device was offline during its plant's shifts on one IST day (F-48)."""
    days, _ = health_days(session, kiosk, now, KEEP_SAMPLES_DAYS)
    for entry in days:
        if entry.day == day:
            return _minutes_in_shifts(session, kiosk.plant_id, day, entry.stretches, "offline")
    return 0
