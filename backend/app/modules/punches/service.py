"""Deciding and storing one kiosk punch (spec M2 §7 rules 5-8).

Order of events for a request that passed the device checks:
 1. A retry (same kiosk + same `client_punch_id`) gets the stored answer; nothing new is made.
 2. The employee behind the card is locked, so two kiosks cannot decide for them at once.
 3. The anti-proxy rules decide: accepted, rejected with a reason, or a test card scan.
 4. The photo is encrypted and uploaded. If storage is down the punch still counts.
 5. The punch (and its photo record) is saved. Rows are never changed afterwards.
"""

import base64
import binascii
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.antiproxy.context import Outcome, PunchContext, PunchLimits
from app.antiproxy.engine import EngineDecision, run_qr_rules
from app.core.config import Settings, get_settings
from app.core.crypto import decode_key, encrypt_snapshot
from app.core.storage import Storage, StorageError, get_storage
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.answers import (
    ALREADY_PUNCHED_CODES,
    punch_answer,
    refused_test_card_answer,
    self_test_answer,
)
from app.modules.punches.models import (
    Punch,
    PunchDecision,
    PunchMethod,
    PunchSnapshot,
    SnapshotState,
)
from app.modules.punches.schemas import KioskPunchRequest, KioskPunchResponse
from app.modules.punches.snapshots import CheckedSnapshot
from app.modules.qr_cards.models import CardKind, QrCredential
from app.modules.qr_cards.payload import parse_payload
from app.modules.settings.service import get_int_setting

logger = logging.getLogger(__name__)

# Sent when the photo is not valid base64, so the snapshot rule answers SNAPSHOT_INVALID.
UNREADABLE_PHOTO = b"not a photo"


@dataclass(frozen=True)
class ClientInfo:
    """Facts about the request that are only stored, never used for a decision."""

    ip: str | None


def load_limits(session: Session) -> PunchLimits:
    return PunchLimits(
        punch_cooldown_minutes=get_int_setting(session, "punch_cooldown_minutes"),
        min_minutes_before_out=get_int_setting(session, "min_minutes_before_out"),
        open_in_max_hours=get_int_setting(session, "open_in_max_hours"),
        snapshot_dark_threshold=get_int_setting(session, "snapshot_dark_threshold"),
    )


def record_kiosk_punch(
    session: Session,
    kiosk: KioskDevice,
    request: KioskPunchRequest,
    client: ClientInfo,
    storage: Storage | None = None,
) -> KioskPunchResponse:
    limits = load_limits(session)

    already_stored = find_punch(session, kiosk, request.client_punch_id)
    if already_stored is not None:
        return punch_answer(session, already_stored, kiosk.name, limits)

    now = utc_now()
    _lock_employee_of_card(session, request.qr_payload or "")
    context = PunchContext(
        session=session,
        app_settings=get_settings(),
        kiosk=kiosk,
        now=now,
        limits=limits,
        qr_text=request.qr_payload,
        snapshot_bytes=_decode_photo(request.snapshot_jpeg),
    )
    decision = run_qr_rules(context)

    if decision.outcome is Outcome.SELF_TEST:
        return _record_self_test(session, kiosk, context, client, now)

    if context.card is not None and context.card.kind == CardKind.TEST.value:
        # A refused test card (revoked, expired, bad photo) is not a worker's punch: no punch
        # row, no photo (F-27). One audit row keeps a trace of the refusal.
        return _record_refused_test_card(
            session, kiosk, context, client, now, decision.reason_codes[0]
        )

    punch = _build_punch(kiosk, request, client, context, decision, now)
    snapshot = _store_snapshot(session, punch, context, decision, now, storage)
    try:
        session.add(punch)
        session.flush()  # the unique (kiosk, client_punch_id) rule is checked here
        if snapshot is not None:
            session.add(snapshot)
        session.commit()
    except IntegrityError:
        # Another request with the same id won the race: undo and give its answer.
        session.rollback()
        delete_file_quietly(snapshot, storage)
        winner = find_punch(session, kiosk, request.client_punch_id)
        if winner is None:
            raise
        return punch_answer(session, winner, kiosk.name, limits)
    except Exception:
        # Any other failure must not leave an encrypted photo behind that no row points to:
        # the purge job works from the rows, so such a file would never be deleted.
        session.rollback()
        delete_file_quietly(snapshot, storage)
        raise
    return punch_answer(session, punch, kiosk.name, limits)


def find_punch(session: Session, kiosk: KioskDevice, client_punch_id: uuid.UUID) -> Punch | None:
    return session.scalar(
        select(Punch).where(Punch.kiosk_id == kiosk.id, Punch.client_punch_id == client_punch_id)
    )


def _decode_photo(photo_text: str | None) -> bytes | None:
    if not photo_text:
        return None
    try:
        return base64.b64decode(photo_text, validate=True)
    except binascii.Error:
        return UNREADABLE_PHOTO


def _lock_employee_of_card(session: Session, qr_text: str) -> None:
    """Lock the card owner's row until the punch is saved (spec §7 rule 6).

    Two kiosks that scan the same person at the same moment then wait for each other, and the
    second one sees the first one's punch. A text that is not a card has nobody to lock: such
    a punch never reaches the IN/OUT rule.
    """
    parsed = parse_payload(qr_text)
    if parsed is None:
        return
    owner_id = session.scalar(
        select(QrCredential.employee_id).where(QrCredential.card_serial == parsed.serial)
    )
    if owner_id is not None:
        session.execute(select(Employee.id).where(Employee.id == owner_id).with_for_update())


def _record_self_test(
    session: Session,
    kiosk: KioskDevice,
    context: PunchContext,
    client: ClientInfo,
    now: datetime,
) -> KioskPunchResponse:
    """A test card proves the gate works. It makes no punch and stores no photo (F-27)."""
    kiosk.last_self_test_at = now
    if context.card is not None:
        context.card.last_used_at = now
    record_audit(
        session,
        actor=Actor(actor_type="kiosk", actor_id=kiosk.id, ip=client.ip),
        action="kiosk.self_test",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after={"card_serial": context.card.card_serial if context.card else None},
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return self_test_answer(kiosk.name, now)


def _record_refused_test_card(
    session: Session,
    kiosk: KioskDevice,
    context: PunchContext,
    client: ClientInfo,
    now: datetime,
    reason_code: str,
) -> KioskPunchResponse:
    record_audit(
        session,
        actor=Actor(actor_type="kiosk", actor_id=kiosk.id, ip=client.ip),
        action="kiosk.test_card_refused",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after={
            "card_serial": context.card.card_serial if context.card else None,
            "reason": reason_code,
        },
        plant_id=kiosk.plant_id,
    )
    session.commit()
    return refused_test_card_answer(kiosk.name, reason_code, now)


def _build_punch(
    kiosk: KioskDevice,
    request: KioskPunchRequest,
    client: ClientInfo,
    context: PunchContext,
    decision: EngineDecision,
    now: datetime,
) -> Punch:
    accepted = decision.outcome is Outcome.ALLOW
    location = request.location
    return Punch(
        id=uuid.uuid4(),
        client_punch_id=request.client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=context.employee.id if context.employee else None,
        qr_credential_id=context.card.id if context.card else None,
        method=PunchMethod.QR.value,
        direction=decision.direction.value if accepted and decision.direction else None,
        decision=PunchDecision.ACCEPTED.value if accepted else PunchDecision.REJECTED.value,
        reason_codes=decision.reason_codes,
        server_received_at=now,
        device_claimed_at=request.device_time,
        lat=location.lat if location else None,
        lon=location.lon if location else None,
        accuracy_m=location.accuracy_m if location else None,
        ip=client.ip,
        app_version=request.app_version,
    )


def _store_snapshot(
    session: Session,
    punch: Punch,
    context: PunchContext,
    decision: EngineDecision,
    now: datetime,
    storage: Storage | None,
) -> PunchSnapshot | None:
    """Encrypt and upload the photo, and return its database record (not yet added).

    Photos of "already punched" scans are not kept: they carry no new evidence. A storage
    failure never stops the gate: the punch is saved and the record says `upload_failed`.
    """
    checked = context.snapshot
    if checked is None or any(code in ALREADY_PUNCHED_CODES for code in decision.reason_codes):
        return None

    retention_days = get_int_setting(session, "snapshot_retention_days")
    key = f"snapshots/{now:%Y/%m/%d}/{punch.id}.bin"
    stored_size = upload_snapshot(punch, checked, key, get_settings(), storage)
    return PunchSnapshot(
        punch_id=punch.id,
        storage_key=key,
        size_bytes=stored_size or 0,
        width=checked.width,
        height=checked.height,
        brightness=checked.brightness,
        is_dark=checked.is_dark,
        taken_at=now,
        expires_at=now + timedelta(days=retention_days),
        state=SnapshotState.STORED.value if stored_size else SnapshotState.UPLOAD_FAILED.value,
    )


def upload_snapshot(
    punch: Punch, checked: CheckedSnapshot, key: str, settings: Settings, storage: Storage | None
) -> int | None:
    """The size of the stored file, or None when it could not be stored."""
    if settings.snapshot_encryption_key is None:
        logger.error("Snapshot not stored: SNAPSHOT_ENCRYPTION_KEY is not set")
        return None
    encrypted = encrypt_snapshot(
        checked.jpeg, punch.id, decode_key(settings.snapshot_encryption_key.get_secret_value())
    )
    try:
        # Looked up inside the try: a missing storage setting is a storage failure too.
        (storage or get_storage()).save(key, encrypted)
    except StorageError:
        # Only the punch id is logged: never the photo, the key text or a person's name.
        logger.warning(
            "Snapshot not stored: the storage failed", extra={"fields": {"punch_id": str(punch.id)}}
        )
        return None
    return len(encrypted)


def delete_file_quietly(snapshot: PunchSnapshot | None, storage: Storage | None) -> None:
    if snapshot is None or snapshot.state != SnapshotState.STORED.value:
        return
    try:
        (storage or get_storage()).delete([snapshot.storage_key])
    except StorageError:
        logger.warning("A leftover snapshot file could not be deleted")
