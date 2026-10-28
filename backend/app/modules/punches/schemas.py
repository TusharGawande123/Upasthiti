"""Request and response shapes of the kiosk punch endpoint (spec M2 §5.2)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.modules.kiosks.schemas import LocationReport
from app.modules.kiosks.time_anchor import TimeAnchor

# The whole request body may not be larger than this (spec §7 rule 5.2).
MAX_BODY_BYTES = 64 * 1024


class FaceFrameIn(BaseModel):
    role: Literal["frontal", "turn"]
    # base64 JPEG (640 × 480 at most, 70 KB decoded at most; checked by the face_frames rule)
    jpeg: str = Field(min_length=1, max_length=100_000)


class KioskPunchRequest(BaseModel):
    client_punch_id: uuid.UUID  # made by the kiosk for each scan; a retry reuses it
    method: Literal["qr", "face"]
    qr_payload: str | None = Field(default=None, max_length=200)  # card punches
    # Face punches (M3, spec §5.2): the challenge the server gave, and 2-4 frames.
    challenge_nonce: str | None = Field(default=None, max_length=64)
    frames: list[FaceFrameIn] | None = Field(default=None, max_length=4)
    # The photo as base64 text. The size limit of the photo itself is checked by the snapshot
    # rule (SNAPSHOT_INVALID); this cap only stops absurd requests early.
    # The route refuses a card punch body over MAX_BODY_BYTES with PAYLOAD_TOO_LARGE first.
    snapshot_jpeg: str | None = Field(default=None, max_length=6 * MAX_BODY_BYTES)
    device_time: datetime | None = None  # what the kiosk's clock says: informational only
    location: LocationReport | None = None  # stored, not checked until M4
    app_version: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def check_method_fields(self) -> KioskPunchRequest:
        # The error names the field only, never what was sent (M2 handler).
        if self.method == "qr":
            if self.qr_payload is None:  # an empty text is a scan to refuse, not a bad request
                raise ValueError("qr_payload is required for a card punch")
            return self
        frames = self.frames or []
        roles = [frame.role for frame in frames]
        if not self.challenge_nonce:
            raise ValueError("challenge_nonce is required for a face punch")
        if not 2 <= len(frames) <= 4 or roles[0] != "frontal" or "turn" not in roles:
            raise ValueError("frames: 2-4 frames, the first frontal and at least one turn")
        return self


class CodeEntry(BaseModel):
    token: str  # single use per try; only its hash is stored
    expires_at: datetime
    tries_left: int


class PunchEmployee(BaseModel):
    display_name: str
    employee_code: str


class PunchDetails(BaseModel):
    """Extra facts the result screen can show ("Already IN at 07:02; OUT after 07:32")."""

    kiosk_name: str
    last_direction: Literal["in", "out"] | None = None
    last_punch_at: datetime | None = None
    out_allowed_from: datetime | None = None
    retry_allowed: bool | None = None  # face rejections where trying again can help
    location_check: str | None = None  # M4 self test: "ok" or the location rule's code


class KioskPunchResponse(BaseModel):
    punch_id: uuid.UUID | None  # none for a self test: nothing is recorded
    decision: Literal["accepted", "rejected", "self_test", "needs_code"]
    direction: Literal["in", "out"] | None
    employee: PunchEmployee | None
    server_time: datetime
    reason_code: str | None
    message_key: str
    voice_key: str
    details: PunchDetails
    code_entry: CodeEntry | None = None  # only with decision "needs_code"
    time_anchor: TimeAnchor | None = None  # M4 §7 rule 8: set by the route


class ChallengeRequest(BaseModel):
    app_version: str | None = Field(default=None, max_length=40)


class CaptureRules(BaseModel):
    min_frames: int
    max_frames: int
    max_width: int
    max_height: int
    max_frame_bytes: int
    min_yaw_degrees: int


class ChallengeResponse(BaseModel):
    challenge_nonce: str
    challenge: Literal["turn_left", "turn_right", "left_then_right", "right_then_left"]
    expires_at: datetime
    server_time: datetime
    capture: CaptureRules
    time_anchor: TimeAnchor | None = None  # M4 §7 rule 8


class CodeTryRequest(BaseModel):
    client_punch_id: uuid.UUID  # new for each try
    code_entry_token: str = Field(min_length=10, max_length=64)
    employee_code: str = Field(min_length=1, max_length=12)


# --- The admin punch log (spec M2 §5.3) ---------------------------------------------------------


class PunchLogEmployee(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class PunchLogPlace(BaseModel):
    id: uuid.UUID
    name: str
    code: str | None = None  # plants have a code; kiosks only a name


class PunchLogSnapshot(BaseModel):
    state: Literal["stored", "purged", "upload_failed", "none"]
    is_dark: bool | None = None  # Super Admin only (F-31)
    expires_at: datetime | None = None
    purged_at: datetime | None = None
    face_found: bool | None = None  # F-30, Super Admin only: was a face seen on the card photo


class PunchFaceEmployee(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class PunchFaceDetail(BaseModel):
    """Super Admin only (spec M3 §5.5): what the face check measured. Never shown to the gate."""

    match_score: float | None
    second_best_score: float | None
    antispoof_score: float | None
    yaw_degrees: float | None
    challenge: str | None
    model_id: str | None
    match_mode: str | None
    claimed_employee: PunchFaceEmployee | None  # whose code was typed (code path)


class PunchLogItem(BaseModel):
    id: uuid.UUID
    server_received_at: datetime
    # None when the card was not identified, or (for a Plant Head) when the person belongs to
    # another plant: then `employee_hidden` is true and the screen says "Card of another plant".
    employee: PunchLogEmployee | None
    employee_hidden: bool
    plant: PunchLogPlace
    kiosk: PunchLogPlace
    method: str
    direction: Literal["in", "out"] | None
    decision: str
    reason_codes: list[str]
    snapshot: PunchLogSnapshot
    match_mode: str | None = None  # M3: one_to_many (by face) or code (by typed code)
    follows_punch_id: uuid.UUID | None = None  # a code-path answer points to "asked for code"
    # The other way round: an "asked for code" row points to the answer that followed it.
    followed_by_punch_id: uuid.UUID | None = None


class PunchLocation(BaseModel):
    lat: float
    lon: float
    accuracy_m: float | None


class PunchDetail(PunchLogItem):
    app_version: str | None
    device_time: datetime | None  # what the kiosk's clock said: never used for a decision
    location: PunchLocation | None
    face: PunchFaceDetail | None = None  # Super Admin only


class PunchSummaryResponse(BaseModel):
    accepted_in: int
    accepted_out: int
    rejected: int
    dark_photos: int | None  # Super Admin only
    rejected_by_reason: dict[str, int]
    # M3: face punches of the day.
    face_accepted: int = 0
    code_accepted: int = 0
    asked_for_code: int = 0
    no_face_photos: int | None = None  # Super Admin only (F-30)


class PunchCompareResponse(BaseModel):
    current: PunchLogItem
    earlier: list[PunchLogItem]  # up to 3, newest first
