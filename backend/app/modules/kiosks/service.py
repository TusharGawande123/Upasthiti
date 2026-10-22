"""Kiosk devices: create, pairing codes, registering a device, revoking (spec §7 rule 5).

Pairing in short: an admin creates a kiosk and gets a 6-digit code (valid 10 minutes, one
use). On the gate device the code is typed in together with the device's public key and its
location. The location must be accurate and inside the plant's geofence: there is no
network check and no approval route (decision 0005).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.auth.rate_limit import (
    FAILED_PAIRINGS_ALL,
    failed_pairing_limiter,
    pairing_limiter,
)
from app.modules.kiosks.crypto import (
    generate_pairing_code,
    hash_pairing_code,
    load_public_key,
)
from app.modules.kiosks.models import KioskDevice, KioskPairingCode, KioskStatus
from app.modules.org.geofence import distance_to_geofence_m
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Plant
from app.modules.settings.service import get_int_setting

MAX_WRONG_TRIES_PER_CODE = 5
# A reported accuracy beyond this is nonsense and is treated as "not accurate enough".
MAX_ACCURACY_REPORTED_M = 100_000


@dataclass(frozen=True)
class IssuedCode:
    kiosk: KioskDevice
    code: str
    expires_at: datetime


@dataclass(frozen=True)
class Location:
    lat: float
    lon: float
    accuracy_m: float


def kiosk_snapshot(kiosk: KioskDevice) -> dict[str, object]:
    return {
        "name": kiosk.name,
        "status": kiosk.status,
        "plant_id": kiosk.plant_id,
        "sound_muted": kiosk.sound_muted,
    }


def get_kiosk(session: Session, kiosk_id: uuid.UUID) -> KioskDevice:
    kiosk = session.get(KioskDevice, kiosk_id)
    if kiosk is None:
        raise ApiError("NOT_FOUND", "Kiosk not found.", 404)
    return kiosk


def list_kiosks(
    session: Session,
    *,
    only_plant_ids: frozenset[uuid.UUID] | None,
    plant_id: uuid.UUID | None = None,
    status: str | None = None,
) -> list[KioskDevice]:
    statement = select(KioskDevice).order_by(KioskDevice.name)
    if only_plant_ids is not None:
        statement = statement.where(KioskDevice.plant_id.in_(only_plant_ids))
    if plant_id:
        statement = statement.where(KioskDevice.plant_id == plant_id)
    if status:
        statement = statement.where(KioskDevice.status == status)
    return list(session.scalars(statement))


def _check_name_is_free(
    session: Session, plant_id: uuid.UUID, name: str, except_kiosk_id: uuid.UUID | None = None
) -> None:
    statement = select(KioskDevice.id).where(
        KioskDevice.plant_id == plant_id, func.lower(KioskDevice.name) == name.lower()
    )
    if except_kiosk_id is not None:
        statement = statement.where(KioskDevice.id != except_kiosk_id)  # renaming to its own name
    if session.scalar(statement):
        raise ApiError("KIOSK_NAME_EXISTS", "This plant already has a kiosk with this name.", 409)


def create_kiosk(session: Session, *, actor: Actor, plant: Plant, name: str) -> IssuedCode:
    if not plant.is_active:
        raise ApiError("PLANT_INACTIVE", "This plant is switched off.", 422)
    if current_geofence(session, plant.id) is None:
        # Pairing needs a geofence to check the location against.
        raise ApiError("GEOFENCE_NOT_SET", "Draw this plant's geofence first.", 422)
    name = name.strip()
    _check_name_is_free(session, plant.id, name)

    kiosk = KioskDevice(plant_id=plant.id, name=name)
    session.add(kiosk)
    session.flush()
    issued = _issue_code(session, actor, kiosk)
    record_audit(
        session,
        actor=actor,
        action="kiosk.create",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after=kiosk_snapshot(kiosk),
        plant_id=plant.id,
    )
    session.commit()
    return issued


def reissue_code(session: Session, *, actor: Actor, kiosk: KioskDevice) -> IssuedCode:
    if kiosk.status == KioskStatus.REVOKED.value:
        raise ApiError("KIOSK_REVOKED", "This kiosk was switched off.", 409)
    if kiosk.status == KioskStatus.ACTIVE.value:
        raise ApiError("KIOSK_ALREADY_PAIRED", "This kiosk is already paired.", 409)
    issued = _issue_code(session, actor, kiosk)
    record_audit(
        session,
        actor=actor,
        action="kiosk.new_pairing_code",
        entity_type="kiosk",
        entity_id=kiosk.id,
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return issued


def current_pairing_code_issue(session: Session, kiosk: KioskDevice) -> KioskPairingCode | None:
    """The newest unused, unexpired code of a kiosk (to show the countdown)."""
    return session.scalar(
        select(KioskPairingCode)
        .where(
            KioskPairingCode.kiosk_id == kiosk.id,
            KioskPairingCode.used_at.is_(None),
            KioskPairingCode.expires_at > utc_now(),
        )
        .order_by(KioskPairingCode.created_at.desc())
    )


def update_kiosk(
    session: Session,
    *,
    actor: Actor,
    kiosk: KioskDevice,
    name: str | None = None,
    sound_muted: bool | None = None,
) -> KioskDevice:
    """Rename the kiosk and/or switch its tones and voice off or on (F-1). The heartbeat tells
    the kiosk within a minute; the switch never affects punching."""
    before = kiosk_snapshot(kiosk)
    if name is not None:
        name = name.strip()
        _check_name_is_free(session, kiosk.plant_id, name, except_kiosk_id=kiosk.id)
        kiosk.name = name
    if sound_muted is not None:
        kiosk.sound_muted = sound_muted
    record_audit(
        session,
        actor=actor,
        action="kiosk.update",
        entity_type="kiosk",
        entity_id=kiosk.id,
        before=before,
        after=kiosk_snapshot(kiosk),
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return kiosk


def revoke_kiosk(session: Session, *, actor: Actor, kiosk: KioskDevice, reason: str) -> KioskDevice:
    if kiosk.status == KioskStatus.REVOKED.value:
        raise ApiError("KIOSK_REVOKED", "This kiosk was already switched off.", 409)
    before = kiosk_snapshot(kiosk)
    kiosk.status = KioskStatus.REVOKED.value
    kiosk.revoked_at = utc_now()
    kiosk.revoke_reason = reason
    # Any unused code of this kiosk stops working too.
    for code in session.scalars(
        select(KioskPairingCode).where(
            KioskPairingCode.kiosk_id == kiosk.id, KioskPairingCode.used_at.is_(None)
        )
    ):
        code.used_at = utc_now()
    record_audit(
        session,
        actor=actor,
        action="kiosk.revoke",
        entity_type="kiosk",
        entity_id=kiosk.id,
        before=before,
        after=kiosk_snapshot(kiosk),
        reason=reason,
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return kiosk


def register_device(
    session: Session,
    *,
    pairing_code: str,
    public_key_spki: str,
    location: Location | None,
    app_version: str | None,
    user_agent: str | None,
    ip: str,
) -> KioskDevice:
    """Pair a device. Checks run in the order of spec §7 rule 5."""
    if not pairing_limiter.allow(ip):
        raise ApiError("TOO_MANY_REQUESTS", "Too many pairing attempts. Try again later.", 429)

    if failed_pairing_limiter.blocked(FAILED_PAIRINGS_ALL):
        raise ApiError("TOO_MANY_REQUESTS", "Too many pairing attempts. Try again later.", 429)
    try:
        code_row = _find_code(session, pairing_code)
    except ApiError as refusal:
        if refusal.code == "PAIRING_CODE_INVALID":
            failed_pairing_limiter.record(FAILED_PAIRINGS_ALL)
        raise
    kiosk = session.get(KioskDevice, code_row.kiosk_id)
    if kiosk is None or kiosk.status != KioskStatus.PENDING.value:
        raise ApiError("PAIRING_CODE_INVALID", "This code is not right.", 400)

    try:
        load_public_key(public_key_spki)
    except ValueError:
        raise ApiError("PUBLIC_KEY_INVALID", "The device key is not valid.", 422) from None

    try:
        _check_location(session, kiosk, location)
    except ApiError as refusal:
        # Repeated refusals use up the code (spec §7 rule 4): after 5, a new code is needed.
        code_row.failed_attempts += 1
        _audit_failed_registration(session, kiosk, refusal.code, location, ip)
        raise

    now = utc_now()
    kiosk.public_key = public_key_spki
    kiosk.status = KioskStatus.ACTIVE.value
    kiosk.registered_at = now
    kiosk.registered_ip = None if ip == "unknown" else ip
    if location is not None:
        kiosk.registered_lat = Decimal(str(round(location.lat, 6)))
        kiosk.registered_lon = Decimal(str(round(location.lon, 6)))
        kiosk.registered_accuracy_m = Decimal(str(round(location.accuracy_m, 1)))
    kiosk.app_version = (app_version or "")[:40] or None
    kiosk.user_agent = (user_agent or "")[:300] or None
    code_row.used_at = now
    record_audit(
        session,
        actor=Actor("kiosk", kiosk.id, ip),
        action="kiosk.register",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after={"status": kiosk.status, "accuracy_m": kiosk.registered_accuracy_m},
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return kiosk


def _issue_code(session: Session, actor: Actor, kiosk: KioskDevice) -> IssuedCode:
    now = utc_now()
    # A new code replaces any older one that was not used yet.
    for old in session.scalars(
        select(KioskPairingCode).where(
            KioskPairingCode.kiosk_id == kiosk.id, KioskPairingCode.used_at.is_(None)
        )
    ):
        old.used_at = now

    code = generate_pairing_code()
    expires_at = now + timedelta(minutes=get_int_setting(session, "pairing_code_minutes"))
    session.add(
        KioskPairingCode(
            kiosk_id=kiosk.id,
            code_hash=hash_pairing_code(code),
            created_by=actor.actor_id,
            expires_at=expires_at,
        )
    )
    session.flush()
    return IssuedCode(kiosk=kiosk, code=code, expires_at=expires_at)


def _find_code(session: Session, pairing_code: str) -> KioskPairingCode:
    """The code row, if the code is right, unused and not expired; otherwise refuse."""
    code_row = session.scalar(
        select(KioskPairingCode)
        .where(KioskPairingCode.code_hash == hash_pairing_code(pairing_code.strip()))
        .order_by(KioskPairingCode.created_at.desc())
    )
    if code_row is None:
        raise ApiError("PAIRING_CODE_INVALID", "This code is not right.", 400)
    if code_row.used_at is not None:
        raise ApiError("PAIRING_CODE_INVALID", "This code is not right.", 400)
    if code_row.failed_attempts >= MAX_WRONG_TRIES_PER_CODE:
        raise ApiError("PAIRING_LOCKED", "Too many tries with this code.", 423)
    if code_row.expires_at <= utc_now():
        raise ApiError("PAIRING_CODE_EXPIRED", "This code has expired.", 400)
    return code_row


def _check_location(session: Session, kiosk: KioskDevice, location: Location | None) -> None:
    """Location is required, accurate and inside the geofence (spec §7 rule 5, step 4)."""
    if location is None:
        raise ApiError("LOCATION_REQUIRED", "This device did not report its location.", 422)
    limit = get_int_setting(session, "gps_accuracy_limit_m")
    if not 0 <= location.accuracy_m <= MAX_ACCURACY_REPORTED_M or location.accuracy_m > limit:
        raise ApiError(
            "GPS_ACCURACY_TOO_LOW",
            "The location is not accurate enough.",
            422,
            {"accuracy_m": round(location.accuracy_m), "limit_m": limit},
        )
    geofence = current_geofence(session, kiosk.plant_id)
    if geofence is None:
        raise ApiError("GEOFENCE_NOT_SET", "This plant has no geofence.", 422)
    distance = distance_to_geofence_m(
        geofence.shape, geofence.geojson, geofence.radius_m, location.lon, location.lat
    )
    if distance > geofence.buffer_m:
        raise ApiError("OUTSIDE_GEOFENCE", "This device is not at the plant.", 422)


def _audit_failed_registration(
    session: Session, kiosk: KioskDevice, reason_code: str, location: Location | None, ip: str
) -> None:
    # The code value is never logged; the reported position helps the admin understand why.
    after: dict[str, object] = {"reason": reason_code}
    if location is not None:
        after |= {
            "lat": round(location.lat, 5),
            "lon": round(location.lon, 5),
            "accuracy_m": round(location.accuracy_m),
        }
    record_audit(
        session,
        actor=Actor("kiosk", kiosk.id, ip),
        action="kiosk.register_failed",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after=after,
        plant_id=kiosk.plant_id,
    )
    session.commit()
