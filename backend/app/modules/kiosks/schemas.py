"""Request and response shapes for kiosk management and pairing."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.modules.kiosks.models import KioskDevice


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

    @classmethod
    def from_model(cls, kiosk: KioskDevice) -> KioskResponse:
        return cls.model_validate(kiosk, from_attributes=True)


class CreateKioskRequest(BaseModel):
    plant_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)


class RenameKioskRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class KioskWithCodeResponse(BaseModel):
    kiosk: KioskResponse
    pairing_code: str  # shown once to the admin; only a keyed hash is stored
    code_expires_at: datetime


class LocationReport(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0)


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


class KioskMeResponse(BaseModel):
    kiosk_id: uuid.UUID
    kiosk_name: str
    status: str
    plant: PlantSummary
    server_time: datetime
