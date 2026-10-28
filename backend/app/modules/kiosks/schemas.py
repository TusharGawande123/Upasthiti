"""Request and response shapes for kiosk management and pairing."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.kiosks.models import KioskDevice
from app.modules.kiosks.time_anchor import TimeAnchor


class KioskResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    name: str
    status: str
    registered_at: datetime | None
    registered_accuracy_m: Decimal | None
    last_seen_at: datetime | None
    app_version: str | None
    revoked_at: datetime | None
    revoke_reason: str | None
    # M2 (additive): the gate's sound switch (F-1) and the last test card scan (F-27).
    sound_muted: bool
    last_self_test_at: datetime | None

    @classmethod
    def from_model(cls, kiosk: KioskDevice) -> KioskResponse:
        return cls.model_validate(kiosk, from_attributes=True)


class CreateKioskRequest(BaseModel):
    plant_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)


class UpdateKioskRequest(BaseModel):
    """Only the fields that are sent change: the name, and the gate's sound switch (F-1)."""

    name: str | None = Field(default=None, min_length=1, max_length=60)
    sound_muted: bool | None = None


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class KioskWithCodeResponse(BaseModel):
    kiosk: KioskResponse
    pairing_code: str  # shown once to the admin; only a keyed hash is stored
    code_expires_at: datetime


class LocationReport(BaseModel):
    # Bounded and finite: the database column holds up to 99999.9, and "inf" or "NaN" must
    # never reach it (that would turn a punch into a server error).
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float = Field(ge=0, le=99999, allow_inf_nan=False)
    # M4: how old the reading is, in seconds (informational online; offline up to 7 days).
    age_s: int | None = Field(default=None, ge=0, le=604_800)


class RegisterKioskRequest(BaseModel):
    pairing_code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")
    public_key_spki: str = Field(min_length=20, max_length=400)
    location: LocationReport | None = None
    app_version: str | None = Field(default=None, max_length=40)


class PlantSummary(BaseModel):
    id: uuid.UUID
    name: str
    code: str


class RegisterKioskResponse(BaseModel):
    kiosk_id: uuid.UUID
    kiosk_name: str
    plant: PlantSummary
    server_time: datetime


class KioskNoticeItem(BaseModel):
    id: uuid.UUID
    text: str
    level: str  # "normal" or "important"
    ends_at: datetime


class KioskFaceSettings(BaseModel):
    """Whether the gate shows "Punch with face", and its timings (spec M3 §5.2)."""

    available: bool  # the engine is ready and the key is set
    state: Literal["ready", "loading", "off"]
    enabled_for_plant: bool  # at least one enrolled face employee at this plant
    challenge_seconds: int
    code_entry_seconds: int
    min_yaw_degrees: int
    code_prefixes: list[str]  # up to 3 common starts of codes here, e.g. "EMP-" (decision 0019)


class KioskFence(BaseModel):
    """The plant's current fence, so the gate can tell by itself whether it is at the plant
    (M4 spec §7 rule 3). Only a guide for the screen: the server checks every punch again."""

    version_id: uuid.UUID
    shape: Literal["polygon", "circle"]
    geojson: dict[str, Any]
    radius_m: float | None
    buffer_m: int


class KioskLocationSettings(BaseModel):
    """How the gate judges its own location (M4 spec §5.1)."""

    accuracy_limit_m: int
    max_age_seconds: int
    refresh_seconds: int
    geofence: KioskFence | None


class KioskOfflineSettings(BaseModel):
    """What the gate needs to save punches while offline (M4 spec §5.1). Only the PUBLIC key."""

    enabled: bool  # false when OFFLINE_EVIDENCE_KEY is not set (development only)
    evidence_key_id: str
    evidence_public_key: str  # base64url, the 65-byte uncompressed P-256 point
    max_items: int
    max_mb: int
    max_hours: int
    cooldown_minutes: int
    sync_max_items: int
    sync_max_bytes: int


class KioskScreenSettings(BaseModel):
    """What the kiosk screen needs from the server settings (spec §5.2)."""

    voice_enabled: bool
    sound_enabled: bool
    result_seconds: int
    reject_seconds: int
    photo_ready_seconds: int  # time to get ready after the card is read, before the photo
    snapshot_retention_days: int  # shown in the privacy line on the idle screen
    dark_threshold: int  # below this brightness the low-light hint appears
    face: KioskFaceSettings | None = None  # M3
    location: KioskLocationSettings | None = None  # M4
    offline: KioskOfflineSettings | None = None  # M4


class KioskMeResponse(BaseModel):
    kiosk_id: uuid.UUID
    kiosk_name: str
    status: str
    plant: PlantSummary
    server_time: datetime
    notices: list[KioskNoticeItem]
    kiosk_settings: KioskScreenSettings
    time_anchor: TimeAnchor | None = None  # M4 §7 rule 8


class KioskReportRequest(BaseModel):
    """A short problem report from a kiosk (S-26). Never carries card texts, images or names."""

    kind: Literal["camera_error", "decoder_fallback", "script_error", "wake_lock_failed", "other"]
    message: str = Field(max_length=300)
    count: int = Field(ge=1, le=100)
    app_version: str | None = Field(default=None, max_length=40)
