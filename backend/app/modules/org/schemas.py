"""Request and response shapes for plants, geofences, departments, shifts and categories."""

import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.org.models import Department, EmployeeCategory, Geofence, Plant, Shift


class PlantResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    address: str
    lat: Decimal | None
    lon: Decimal | None
    is_active: bool
    geofence_set: bool
    active_kiosks: int
    active_employees: int


class CreatePlantRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=2, max_length=10)
    address: str = Field(default="", max_length=500)
    lat: Decimal | None = None
    lon: Decimal | None = None


class UpdatePlantRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    lat: Decimal | None = None
    lon: Decimal | None = None


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class ClientPlantsResponse(BaseModel):
    created: int
    skipped: int


class SetupStepResponse(BaseModel):
    key: str
    done: bool


class SetupStatusResponse(BaseModel):
    steps: list[SetupStepResponse]


class ReadinessResponse(BaseModel):
    plant_id: uuid.UUID
    geofence: bool
    active_shifts: int
    active_categories: int
    active_kiosks: int
    active_employees: int
    ready: bool


class GeofenceRequest(BaseModel):
    shape: Literal["polygon", "circle"]
    geojson: dict[str, Any]
    radius_m: float | None = None
    buffer_m: int
    reason: str | None = Field(default=None, max_length=500)


class GeofenceResponse(BaseModel):
    id: uuid.UUID
    version: int
    shape: str
    geojson: dict[str, Any]
    radius_m: Decimal | None
    buffer_m: int
    is_current: bool
    created_at: datetime
    created_by: uuid.UUID | None

    @classmethod
    def from_model(cls, geofence: Geofence) -> GeofenceResponse:
        return cls.model_validate(geofence, from_attributes=True)


class NamedItemRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class NamedItemResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    name: str
    is_active: bool

    @classmethod
    def from_model(cls, item: Department | EmployeeCategory) -> NamedItemResponse:
        return cls.model_validate(item, from_attributes=True)


class CreateShiftRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    start_time: time
    end_time: time
    grace_min: int = Field(default=10, ge=0, le=240)
    half_day_min: int = Field(default=240, ge=0, le=1440)
    ot_after_min: int = Field(default=480, ge=0, le=1440)


class UpdateShiftRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    start_time: time | None = None
    end_time: time | None = None
    grace_min: int | None = Field(default=None, ge=0, le=240)
    half_day_min: int | None = Field(default=None, ge=0, le=1440)
    ot_after_min: int | None = Field(default=None, ge=0, le=1440)


class ShiftResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    name: str
    start_time: time
    end_time: time
    crosses_midnight: bool
    grace_min: int
    half_day_min: int
    ot_after_min: int
    is_active: bool

    @classmethod
    def from_model(cls, shift: Shift) -> ShiftResponse:
        return cls.model_validate(shift, from_attributes=True)


def plant_response(
    plant: Plant, *, geofence_set: bool, kiosks: int, employees: int
) -> PlantResponse:
    return PlantResponse(
        id=plant.id,
        name=plant.name,
        code=plant.code,
        address=plant.address,
        lat=plant.lat,
        lon=plant.lon,
        is_active=plant.is_active,
        geofence_set=geofence_set,
        active_kiosks=kiosks,
        active_employees=employees,
    )
