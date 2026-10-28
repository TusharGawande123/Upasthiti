"""Request and answer shapes of the offline sync (M4 spec §5.2).

The device sends each queued punch as the exact JSON text it signed when the punch was made
(`signed_item`), so the server checks the signature over the very bytes the device signed and
only then reads the text. The evidence inside is sealed for the server (app/core/offline_crypto).
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.kiosks.schemas import LocationReport
from app.modules.kiosks.time_anchor import TimeAnchor
from app.modules.punches.schemas import FaceFrameIn

Challenge = Literal["turn_left", "turn_right", "left_then_right", "right_then_left"]
MAX_SYNC_ITEMS = 20
MAX_ITEM_TEXT = 900_000  # a face item with 4 frames is about 400 KB of base64; room to spare


class SyncItemIn(BaseModel):
    counter: int = Field(ge=1)  # reserved on the device when the punch was made
    signed_item: str = Field(min_length=2, max_length=MAX_ITEM_TEXT)
    signature: str = Field(min_length=10, max_length=200)  # base64url ECDSA P-256 (r‖s)


class SyncRequest(BaseModel):
    items: list[SyncItemIn] = Field(min_length=1, max_length=MAX_SYNC_ITEMS)
    app_version: str | None = Field(default=None, max_length=40)


class ItemTime(BaseModel):
    anchor: TimeAnchor  # the last anchor the device got before the punch
    elapsed_ms: int = Field(ge=0, le=31 * 24 * 3600 * 1000)
    wall_elapsed_ms: int = Field(ge=-31 * 24 * 3600 * 1000, le=31 * 24 * 3600 * 1000)
    same_session: bool
    device_time: datetime | None = None


class ItemEvidence(BaseModel):
    key_id: str = Field(pattern=r"^[A-Z]$")
    ephemeral_public_key: str = Field(max_length=100)
    nonce: str = Field(max_length=40)
    ciphertext: str = Field(min_length=1, max_length=MAX_ITEM_TEXT)


class OfflineLocation(LocationReport):
    # Offline the gate may reuse its last good reading for up to 7 days (§14 answer 1).
    age_s: int | None = Field(default=None, ge=0, le=604_800)


class SignedItem(BaseModel):
    """The text inside `signed_item`, read only after its signature was checked."""

    v: Literal[1]
    client_punch_id: uuid.UUID
    method: Literal["qr", "face"]
    challenge: Literal["turn_left", "turn_right", "left_then_right", "right_then_left"] | None = (
        None
    )
    time: ItemTime
    location: OfflineLocation
    evidence: ItemEvidence
    app_version: str | None = Field(default=None, max_length=40)


class CardEvidence(BaseModel):
    """The opened evidence of a card punch (M2 limits are checked by the card rules)."""

    qr_payload: str = Field(max_length=200)
    snapshot_jpeg: str = Field(max_length=6 * 64 * 1024)


class FaceEvidence(BaseModel):
    """The opened evidence of a face punch (M3 frame limits are checked by the face rules)."""

    employee_code: str = Field(min_length=1, max_length=20)
    frames: list[FaceFrameIn] = Field(min_length=2, max_length=4)


SyncOutcome = Literal["saved", "already_saved", "retry_later", "refused"]


class SyncItemResult(BaseModel):
    client_punch_id: uuid.UUID | None
    result: SyncOutcome
    punch_id: uuid.UUID | None = None
    decision: Literal["accepted", "rejected"] | None = None  # a flagged punch says "accepted"
    reason_code: str | None = None


class SyncResponse(BaseModel):
    results: list[SyncItemResult]
    server_time: datetime
    time_anchor: TimeAnchor | None = None
