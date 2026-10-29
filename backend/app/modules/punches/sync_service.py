"""The offline sync: punches the gate saved without internet, decided by the server (M4 §7 rule 11).

For each item of a signed sync request, in this order:
  1. the item's own signature (made when the punch was made) checks out with THIS device's key
     -> else refused ITEM_SIGNATURE_INVALID;
  2. its text is a valid item -> else refused ITEM_INVALID;
  3. a punch with the same client_punch_id exists -> already_saved, with its stored decision
     (an online request that did arrive, or an earlier sync whose answer was lost);
  4. its counter is older than this sync request and not used by another offline punch
     -> else refused ITEM_COUNTER_INVALID (a replayed or re-signed copy);
  5. the server works out the punch time (offline_time.py);
  6. the sealed evidence opens -> else a rejected punch OFFLINE_EVIDENCE_UNREADABLE, so the admin
     sees that a punch was lost;
  7. the card or face rules decide, with "now" = the punch time.
Items are decided oldest first. After 20 s no new item is started ("retry later"): the device
sends the rest at once. Refused items write no punch, one audit row each; the request writes one
`kiosk.sync` audit row with counts only, never item contents.
"""

import hashlib
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.offline_crypto import (
    EvidenceUnreadableError,
    SealedEvidence,
    b64url_decode,
    evidence_binding,
    load_offline_key,
    open_evidence,
)
from app.core.storage import Storage
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.modules.audit.service import Actor, record_audit
from app.modules.kiosks.crypto import verify_signature
from app.modules.kiosks.location_check import Location
from app.modules.kiosks.models import KioskDevice
from app.modules.kiosks.schemas import LocationReport
from app.modules.punches import service
from app.modules.punches.models import Punch, PunchDecision
from app.modules.punches.offline_face_service import OfflineFaceEvidence, record_offline_face_punch
from app.modules.punches.offline_time import (
    UNPROVEN,
    OfflinePunch,
    ProvenTime,
    ReportedTime,
    prove_punch_time,
)
from app.modules.punches.schemas import KioskPunchRequest, KioskPunchResponse
from app.modules.punches.sync_schemas import (
    CardEvidence,
    FaceEvidence,
    SignedItem,
    SyncItemIn,
    SyncItemResult,
    SyncOutcome,
    SyncRequest,
)
from app.modules.settings.service import get_int_setting

logger = logging.getLogger(__name__)

STATEMENT_PREFIX = "UPS-OFFLINE-1"
TIME_BUDGET_SECONDS = 20.0


def item_statement(kiosk_id: uuid.UUID, counter: int, signed_item: str) -> bytes:
    """What the device signs for one queued punch (the same text in frontend/src/kiosk/offline)."""
    text_hash = hashlib.sha256(signed_item.encode()).hexdigest()
    return f"{STATEMENT_PREFIX}\n{kiosk_id}\n{counter}\n{text_hash}".encode()


@dataclass
class _Ready:
    """An item that passed steps 1-4 and has its punch time."""

    index: int
    counter: int
    item: SignedItem
    proven: ProvenTime


def sync_items(
    session: Session,
    kiosk: KioskDevice,
    request: SyncRequest,
    request_counter: int,
    client: service.ClientInfo,
    engine: FaceEngine,
    storage: Storage | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> list[SyncItemResult]:
    settings = get_settings()
    if settings.offline_evidence_key is None:
        raise ApiError("OFFLINE_NOT_CONFIGURED", "Offline punches are not set up.", 503)
    received_at = utc_now()
    drift = get_int_setting(session, "offline_clock_drift_seconds")
    max_hours = get_int_setting(session, "offline_max_hours")

    results: list[SyncItemResult | None] = [None] * len(request.items)
    ready: list[_Ready] = []
    used_counters: set[int] = set()
    for index, sync_item in enumerate(request.items):
        checked = _check_item(session, kiosk, sync_item, request_counter, used_counters)
        if isinstance(checked, SyncItemResult):
            results[index] = checked
            if checked.result == "refused":
                _audit_refusal(session, kiosk, client, checked)
            continue
        used_counters.add(sync_item.counter)
        reported = ReportedTime(
            anchor=checked.time.anchor,
            elapsed_ms=checked.time.elapsed_ms,
            wall_elapsed_ms=checked.time.wall_elapsed_ms,
            same_session=checked.time.same_session,
            device_time=checked.time.device_time,
        )
        proven = prove_punch_time(
            kiosk.id, sync_item.counter, reported, received_at, drift, max_hours
        )
        ready.append(_Ready(index, sync_item.counter, checked, proven))

    _unprove_out_of_order(ready)
    ready.sort(key=lambda entry: (entry.proven.punch_time, entry.counter))
    started = clock()
    for entry in ready:
        if clock() - started > TIME_BUDGET_SECONDS:
            results[entry.index] = _result(entry.item.client_punch_id, "retry_later")
            continue
        offline = OfflinePunch(
            entry.proven.punch_time, entry.proven.proof, received_at, entry.counter
        )
        results[entry.index] = _decide(session, kiosk, entry.item, offline, client, engine, storage)

    final = [result or _result(None, "retry_later") for result in results]
    if any(result.result in ("saved", "already_saved") for result in final):
        kiosk.last_sync_at = received_at  # for the devices page (M4 spec §7 rule 15)
    _audit_sync(session, kiosk, client, final)
    return final


def _check_item(
    session: Session,
    kiosk: KioskDevice,
    sync_item: SyncItemIn,
    request_counter: int,
    used_counters: set[int],
) -> SignedItem | SyncItemResult:
    statement = item_statement(kiosk.id, sync_item.counter, sync_item.signed_item)
    if kiosk.public_key is None or not verify_signature(
        kiosk.public_key, statement, sync_item.signature
    ):
        return _result(None, "refused", "ITEM_SIGNATURE_INVALID")
    try:
        item = SignedItem.model_validate_json(sync_item.signed_item)
    except ValidationError:
        return _result(None, "refused", "ITEM_INVALID")

    stored = service.find_punch(session, kiosk, item.client_punch_id)
    if stored is not None:
        return _stored_result(stored, "already_saved")

    counter_taken = session.scalar(
        select(Punch.id).where(
            Punch.kiosk_id == kiosk.id, Punch.device_counter == sync_item.counter
        )
    )
    if (
        sync_item.counter >= request_counter
        or sync_item.counter in used_counters
        or counter_taken is not None
    ):
        return _result(item.client_punch_id, "refused", "ITEM_COUNTER_INVALID")
    return item


def _unprove_out_of_order(ready: list[_Ready]) -> None:
    """Within one batch and one anchor, a later counter must not have an earlier time (§7 rule
    8.3): a device that reorders its clock loses the proof for those items."""
    by_anchor: dict[str, list[_Ready]] = {}
    for entry in ready:
        by_anchor.setdefault(entry.item.time.anchor.token, []).append(entry)
    for entries in by_anchor.values():
        entries.sort(key=lambda entry: entry.counter)
        for earlier, later in zip(entries, entries[1:], strict=False):
            if later.proven.punch_time < earlier.proven.punch_time:
                later.proven = ProvenTime(later.proven.punch_time, UNPROVEN)


def _decide(
    session: Session,
    kiosk: KioskDevice,
    item: SignedItem,
    offline: OfflinePunch,
    client: service.ClientInfo,
    engine: FaceEngine,
    storage: Storage | None,
) -> SyncItemResult:
    plaintext = _open(kiosk, item)
    try:
        if item.method == "qr":
            evidence = None if plaintext is None else _parse(CardEvidence, plaintext)
            if evidence is None:
                return _unreadable(session, kiosk, item, offline, client)
            answer = service.record_kiosk_punch(
                session, kiosk, _card_request(item, evidence), client, storage, offline=offline
            )
            return _answer_result(item, answer)
        face = None if plaintext is None else _parse(FaceEvidence, plaintext)
        if face is None:
            return _unreadable(session, kiosk, item, offline, client)
        face_answer = record_offline_face_punch(
            session,
            kiosk,
            client_punch_id=item.client_punch_id,
            challenge=item.challenge,
            evidence=OfflineFaceEvidence(
                face.employee_code, [(frame.role, frame.jpeg) for frame in face.frames]
            ),
            location=Location(item.location.lat, item.location.lon, item.location.accuracy_m),
            location_age_s=item.location.age_s or 0,
            offline=offline,
            client=client,
            engine=engine,
            app_version=item.app_version,
            storage=storage,
        )
        if face_answer is None:
            return _result(item.client_punch_id, "retry_later")
        return _answer_result(item, face_answer)
    except ApiError as error:
        # A server-side problem with this one item (face set-up missing, storage busy...): the
        # device keeps it and sends it again later.
        session.rollback()
        logger.warning("sync item kept for later", extra={"fields": {"code": error.code}})
        return _result(item.client_punch_id, "retry_later")


def _open(kiosk: KioskDevice, item: SignedItem) -> bytes | None:
    settings = get_settings()
    if settings.offline_evidence_key is None or item.evidence.key_id != (
        settings.offline_evidence_key_id
    ):
        return None
    key = load_offline_key(settings.offline_evidence_key.get_secret_value())
    try:
        sealed = SealedEvidence(
            key_id=item.evidence.key_id,
            ephemeral_public_key=b64url_decode(item.evidence.ephemeral_public_key),
            nonce=b64url_decode(item.evidence.nonce),
            ciphertext=b64url_decode(item.evidence.ciphertext),
        )
        binding = evidence_binding(
            kiosk.id, item.client_punch_id, item.method, item.evidence.key_id
        )
        return open_evidence(key, sealed, binding)
    except EvidenceUnreadableError, ValueError:
        return None


def _parse[Evidence: CardEvidence | FaceEvidence](
    model: type[Evidence], plaintext: bytes
) -> Evidence | None:
    try:
        return model.model_validate_json(plaintext)
    except ValidationError:
        return None


def _card_request(item: SignedItem, evidence: CardEvidence) -> KioskPunchRequest:
    location = item.location
    return KioskPunchRequest(
        client_punch_id=item.client_punch_id,
        method="qr",
        qr_payload=evidence.qr_payload,
        snapshot_jpeg=evidence.snapshot_jpeg,
        device_time=item.time.device_time,
        location=LocationReport(
            lat=location.lat, lon=location.lon, accuracy_m=location.accuracy_m, age_s=location.age_s
        ),
        app_version=item.app_version,
    )


def _unreadable(
    session: Session,
    kiosk: KioskDevice,
    item: SignedItem,
    offline: OfflinePunch,
    client: service.ClientInfo,
) -> SyncItemResult:
    """A punch whose evidence cannot be opened is still recorded, so it is never silently lost."""
    location = item.location
    punch = Punch(
        id=uuid.uuid4(),
        client_punch_id=item.client_punch_id,
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        method=item.method,
        decision=PunchDecision.REJECTED.value,
        reason_codes=["OFFLINE_EVIDENCE_UNREADABLE"],
        **service.offline_columns(offline, offline.punch_time),
        device_claimed_at=item.time.device_time,
        lat=location.lat,
        lon=location.lon,
        accuracy_m=location.accuracy_m,
        location_age_s=location.age_s,
        ip=client.ip,
        app_version=item.app_version,
    )
    try:
        session.add(punch)
        session.commit()
    except IntegrityError:
        session.rollback()
        winner = service.find_punch(session, kiosk, item.client_punch_id)
        if winner is None:
            raise
        return _stored_result(winner, "already_saved")
    return _stored_result(punch, "saved")


def _answer_result(item: SignedItem, answer: KioskPunchResponse) -> SyncItemResult:
    decision = answer.decision if answer.decision in ("accepted", "rejected") else None
    return SyncItemResult(
        client_punch_id=item.client_punch_id,
        result="saved",
        punch_id=answer.punch_id,
        decision=decision,  # type: ignore[arg-type]
        reason_code=answer.reason_code,
    )


def _stored_result(punch: Punch, result: SyncOutcome) -> SyncItemResult:
    counts = punch.decision in (PunchDecision.ACCEPTED.value, PunchDecision.FLAGGED.value)
    return SyncItemResult(
        client_punch_id=punch.client_punch_id,
        result=result,
        punch_id=punch.id,
        decision="accepted" if counts else "rejected",
        reason_code=None if counts else (punch.reason_codes[0] if punch.reason_codes else None),
    )


def _result(
    client_punch_id: uuid.UUID | None, result: SyncOutcome, code: str | None = None
) -> SyncItemResult:
    return SyncItemResult(client_punch_id=client_punch_id, result=result, reason_code=code)


def _audit_refusal(
    session: Session, kiosk: KioskDevice, client: service.ClientInfo, refused: SyncItemResult
) -> None:
    record_audit(
        session,
        actor=Actor("kiosk", kiosk.id, client.ip),
        action="kiosk.sync_item_refused",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after={
            "client_punch_id": str(refused.client_punch_id) if refused.client_punch_id else None,
            "reason": refused.reason_code,
        },
        plant_id=kiosk.plant_id,
    )
    session.commit()


def _audit_sync(
    session: Session,
    kiosk: KioskDevice,
    client: service.ClientInfo,
    results: list[SyncItemResult],
) -> None:
    counts: dict[str, int] = {}
    for result in results:
        counts[result.result] = counts.get(result.result, 0) + 1
    record_audit(
        session,
        actor=Actor("kiosk", kiosk.id, client.ip),
        action="kiosk.sync",
        entity_type="kiosk",
        entity_id=kiosk.id,
        after=counts,
        plant_id=kiosk.plant_id,
    )
    session.commit()
    logger.info("kiosk sync", extra={"fields": {"kiosk_id": str(kiosk.id), **counts}})
