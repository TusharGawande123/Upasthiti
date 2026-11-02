"""Request and response shapes of the phone pages and the admin "Phone attendance" card
(M4b spec §5.1, §5.1b, §5.2, §5.5)."""

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.kiosks.schemas import LocationReport
from app.modules.punches.schemas import CaptureRules, EarlyOutPrompt, FaceFrameIn

ChallengeName = Literal["turn_left", "turn_right", "left_then_right", "right_then_left"]


class Reason(BaseModel):
    """Every Super Admin change carries a reason of 3 to 300 characters (spec §5.5)."""

    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason")
    @classmethod
    def not_only_spaces(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("reason: at least 3 characters")
        return cleaned


# --- Sign-in --------------------------------------------------------------------------------------


class LoginRequest(BaseModel):
    employee_code: str = Field(min_length=1, max_length=12)
    password: str = Field(min_length=1, max_length=128)


class PlantShort(BaseModel):
    code: str
    name: str


class SignedInEmployee(BaseModel):
    code: str
    name: str
    plant: PlantShort
    punch_method: Literal["face", "qr"]


class SignInResponse(BaseModel):
    employee: SignedInEmployee
    notice_required: bool


# --- Me -------------------------------------------------------------------------------------------


class PlantFull(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class MeEmployee(BaseModel):
    code: str
    name: str
    first_name: str
    plant: PlantFull
    punch_method: Literal["face", "qr"]


class MeAccess(BaseModel):
    outside_work_allowed: bool  # already False after the "until" day (F-69)
    outside_work_until: date | None


class MeNotice(BaseModel):
    required: bool
    version: str


class MeReady(BaseModel):
    face: bool  # active agreed consent + active template of the running model


class PasskeyItem(BaseModel):
    id: uuid.UUID
    label: str
    created_at: datetime
    last_used_at: datetime | None


class LastPunch(BaseModel):
    direction: Literal["in", "out"]
    time: datetime
    channel: Literal["kiosk", "phone"]


class MeToday(BaseModel):
    last_punch: LastPunch | None


class MeSettings(BaseModel):
    gps_accuracy_limit_m: int
    location_max_age_seconds: int
    challenge_seconds: int
    photo_ready_seconds: int
    capture: CaptureRules


class MeGeofence(BaseModel):
    version_id: uuid.UUID
    shape: str
    geojson: dict[str, Any]
    radius_m: float | None
    buffer_m: int


class MeResponse(BaseModel):
    employee: MeEmployee
    access: MeAccess
    notice: MeNotice
    ready: MeReady
    passkeys: list[PasskeyItem]
    today: MeToday
    settings: MeSettings
    geofence: MeGeofence | None


# --- Notice ---------------------------------------------------------------------------------------


class NoticeResponse(BaseModel):
    version: str
    language: str
    text: str
    text_sha256: str


class NoticeAcceptRequest(BaseModel):
    version: str = Field(min_length=1, max_length=40)
    text_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class NoticeAcceptResponse(BaseModel):
    accepted_at: datetime


class StopRequest(BaseModel):
    confirm: Literal[True]


# --- Proofs and password --------------------------------------------------------------------------


class FaceProofChallengeRequest(BaseModel):
    employee_code: str = Field(min_length=1, max_length=12)


class FaceProofChallengeResponse(BaseModel):
    proof_id: uuid.UUID
    challenge_nonce: str
    challenge: ChallengeName
    expires_at: datetime
    server_time: datetime
    capture: CaptureRules


class FaceProofRequest(BaseModel):
    proof_id: uuid.UUID
    challenge_nonce: str = Field(min_length=1, max_length=64)
    frames: list[FaceFrameIn] = Field(min_length=2, max_length=4)


class CardProofRequest(BaseModel):
    qr_payload: str = Field(max_length=200)
    location: LocationReport | None = None


class ProvenEmployee(BaseModel):
    code: str
    first_name: str


class ProofResponse(BaseModel):
    proof_token: str  # base64url, 43 characters; only its hash is stored
    expires_at: datetime
    employee: ProvenEmployee


class SetPasswordRequest(BaseModel):
    proof_token: str = Field(min_length=20, max_length=64)
    new_password: str = Field(min_length=1, max_length=200)  # the rules answer PASSWORD_TOO_WEAK


# --- Punches (spec §5.3) --------------------------------------------------------------------------


class PhoneChallengeResponse(BaseModel):
    challenge_nonce: str
    challenge: ChallengeName
    expires_at: datetime
    server_time: datetime
    capture: CaptureRules


class PhoneFacePunchRequest(BaseModel):
    client_punch_id: uuid.UUID  # made by the phone for each try; a retry reuses it
    challenge_nonce: str = Field(min_length=1, max_length=64)
    frames: list[FaceFrameIn] = Field(min_length=2, max_length=4)
    # A missing reading is a decided refusal (LOCATION_REQUIRED), not a broken request.
    location: LocationReport | None = None
    app_version: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def check_frame_shape(self) -> PhoneFacePunchRequest:
        roles = [frame.role for frame in self.frames]
        if roles[0] != "frontal" or "turn" not in roles:
            raise ValueError("frames: the first frontal and at least one turn")
        return self


class PhoneGateCodePunchRequest(BaseModel):
    client_punch_id: uuid.UUID
    gate_code: str = Field(min_length=1, max_length=100)
    # The selfie as base64 text; its size and content are judged by the snapshot rule, which
    # answers SNAPSHOT_MISSING / SNAPSHOT_INVALID (the body limit of 64 KB stops absurd sizes).
    photo_jpeg: str | None = Field(default=None, max_length=100_000)
    location: LocationReport | None = None
    app_version: str | None = Field(default=None, max_length=40)


class PhoneEarlyOutConfirmRequest(BaseModel):
    """Agree at the early-OUT alert (decision 0036 line 88). A gate-code punch sends its selfie
    again (it was never stored); a face punch needs no picture. The location is read again."""

    client_punch_id: uuid.UUID  # the one of the punch that was asked about
    token: str = Field(min_length=20, max_length=2000)
    photo_jpeg: str | None = Field(default=None, max_length=100_000)
    location: LocationReport | None = None
    app_version: str | None = Field(default=None, max_length=40)


class PhonePunchDetails(BaseModel):
    retry_allowed: bool | None = None  # a face problem where trying again can help


class PhonePunchResponse(BaseModel):
    """The phone's answer. A flagged punch answers "accepted"; only `outside_plant` tells the
    person it was saved as an outside-plant punch (no other flag is shown, spec §5.3).
    "needs_confirmation": an OUT before the shift end; nothing is stored, `early_out` holds the
    alert's facts and the token that Agree sends to the confirm endpoint."""

    punch_id: uuid.UUID | None  # none when a gate code names no known device (nothing is stored)
    decision: Literal["accepted", "rejected", "needs_confirmation"]
    reason_code: str | None
    direction: Literal["in", "out"] | None
    punch_time: datetime
    outside_plant: bool
    details: PhonePunchDetails
    early_out: EarlyOutPrompt | None = None  # only with decision "needs_confirmation"


class TodayPunch(BaseModel):
    time: datetime
    direction: Literal["in", "out"]
    channel: Literal["kiosk", "phone"]
    decision_text_key: str


class TodayPunchesResponse(BaseModel):
    items: list[TodayPunch]


class AttendanceDayView(BaseModel):
    date: date
    status: str
    first_in: datetime | None
    last_out: datetime | None
    worked_min: int
    channels: list[Literal["phone", "kiosk"]]


class MyAttendanceResponse(BaseModel):
    days: list[AttendanceDayView]


# --- Passkeys (F-80) ------------------------------------------------------------------------------


class PasskeyOptionsResponse(BaseModel):
    options: dict[str, Any]  # WebAuthn options as JSON (base64url fields)


class PasskeyRegisterRequest(BaseModel):
    credential: dict[str, Any]


class PasskeyAdded(BaseModel):
    id: uuid.UUID
    label: str


class PasskeyLoginOptionsRequest(BaseModel):
    employee_code: str = Field(min_length=1, max_length=12)


class PasskeyLoginRequest(BaseModel):
    employee_code: str = Field(min_length=1, max_length=12)
    credential: dict[str, Any]


# --- Admin ----------------------------------------------------------------------------------------


class AccessRequest(Reason):
    phone_punch_enabled: bool


class OutsideWorkRequest(Reason):
    allowed: bool
    until: date | None = None


class AccountView(BaseModel):
    state: Literal["no_password", "active", "locked", "new_password_required"]
    password_set_at: datetime | None
    proof_kind: Literal["face", "card"] | None
    locked_until: datetime | None


class NoticeView(BaseModel):
    version: str
    accepted_at: datetime


class SessionView(BaseModel):
    id: uuid.UUID
    started_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    browser: str
    system: str
    ip: str | None  # Super Admin only


class PhoneAccessView(BaseModel):
    phone_punch_enabled: bool
    phone_changed_at: datetime | None
    phone_changed_by: uuid.UUID | None
    outside_work_allowed: bool
    outside_work_until: date | None
    outside_work_ended: bool  # F-69: the "until" day is over (the daily job turns it off)
    outside_changed_at: datetime | None
    outside_changed_by: uuid.UUID | None
    account: AccountView
    notice: NoticeView | None
    sessions: list[SessionView]
    passkeys: list[PasskeyItem]


class SignOutAllResponse(BaseModel):
    ended: int
