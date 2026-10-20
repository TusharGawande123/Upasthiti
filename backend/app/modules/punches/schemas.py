"""Request and response shapes of the kiosk punch endpoint (spec M2 §5.2)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.kiosks.schemas import LocationReport

# The whole request body may not be larger than this (spec §7 rule 5.2).
MAX_BODY_BYTES = 64 * 1024


class KioskPunchRequest(BaseModel):
    client_punch_id: uuid.UUID  # made by the kiosk for each scan; a retry reuses it
    method: Literal["qr"]  # M3 adds "face"
    qr_payload: str = Field(max_length=200)
    # The photo as base64 text. The size limit of the photo itself is checked by the snapshot
    # rule (SNAPSHOT_INVALID); this cap only stops absurd requests early.
    snapshot_jpeg: str | None = Field(default=None, max_length=MAX_BODY_BYTES)
    device_time: datetime | None = None  # what the kiosk's clock says: informational only
    location: LocationReport | None = None  # stored, not checked until M4
    app_version: str | None = Field(default=None, max_length=40)


class PunchEmployee(BaseModel):
    display_name: str
    employee_code: str


class PunchDetails(BaseModel):
    """Extra facts the result screen can show ("Already IN at 07:02; OUT after 07:32")."""

    kiosk_name: str
    last_direction: Literal["in", "out"] | None = None
    last_punch_at: datetime | None = None
    out_allowed_from: datetime | None = None


class KioskPunchResponse(BaseModel):
    punch_id: uuid.UUID | None  # none for a self test: nothing is recorded
    decision: Literal["accepted", "rejected", "self_test"]
    direction: Literal["in", "out"] | None
    employee: PunchEmployee | None
    server_time: datetime
    reason_code: str | None
    message_key: str
    voice_key: str
    details: PunchDetails
