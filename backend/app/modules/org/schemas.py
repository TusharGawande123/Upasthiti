"""Request and response shapes for plants, geofences, departments, shifts and categories."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.org.models import (
    Department,
    EmployeeCategory,
    Geofence,
    Plant,
    PlantWeeklyOff,
    Shift,
    ShiftRuleVersion,
)
from app.modules.org.shift_rules_service import shift_length_minutes


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
    # M5 (spec §7 rule 3): empty until the plant starts using the attendance devices.
    attendance_start_date: date | None = None


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
    attendance_start_date: date | None = None


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
    # M4 (additive, spec §5.4): is a gate device of this plant working right now, and does its
    # last heartbeat say the location is good?
    device_online: bool = False
    location_good: bool = False
    # M5 (additive, spec §5.8).
    attendance_start_set: bool = False
    weekly_off_set: bool = False


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


# Grace is the same at the start and the end; overtime counts from the shift end, only when it
# reaches overtime_min_minutes (M5 spec §7 rules 9 and 11). An old client that still sends
# `ot_after_min` is ignored: unknown fields are dropped.
class CreateShiftRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    start_time: time
    end_time: time
    grace_min: int = Field(default=30, ge=0, le=120)
    half_day_min: int = Field(default=240, ge=0, le=1440)
    overtime_min_minutes: int = Field(default=120, ge=0, le=480)


class UpdateShiftRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    start_time: time | None = None
    end_time: time | None = None
    grace_min: int | None = Field(default=None, ge=0, le=120)
    half_day_min: int | None = Field(default=None, ge=0, le=1440)
    overtime_min_minutes: int | None = Field(default=None, ge=0, le=480)
    # The date the changed rules apply from (today or later; default today).
    rules_effective_from: date | None = None


class ShiftRulesResponse(BaseModel):
    effective_from: date
    start_time: time
    end_time: time
    crosses_midnight: bool
    shift_length_min: int
    grace_min: int
    half_day_min: int
    overtime_min_minutes: int
    created_at: datetime

    @classmethod
    def from_model(cls, version: ShiftRuleVersion) -> ShiftRulesResponse:
        return cls(
            effective_from=version.effective_from,
            start_time=version.start_time,
            end_time=version.end_time,
            crosses_midnight=version.crosses_midnight,
            shift_length_min=shift_length_minutes(version.start_time, version.end_time),
            grace_min=version.grace_min,
            half_day_min=version.half_day_min,
            overtime_min_minutes=version.overtime_min_minutes,
            created_at=version.created_at,
        )


class ShiftResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    name: str
    start_time: time
    end_time: time
    crosses_midnight: bool
    shift_length_min: int  # the full day (read-only)
    grace_min: int
    half_day_min: int
    overtime_min_minutes: int
    is_active: bool
    rules_from: date | None  # the date of the rule version in force today
    upcoming_rules: ShiftRulesResponse | None

    @classmethod
    def from_model(
        cls,
        shift: Shift,
        *,
        current: ShiftRuleVersion | None,
        upcoming: ShiftRuleVersion | None,
    ) -> ShiftResponse:
        return cls(
            id=shift.id,
            plant_id=shift.plant_id,
            name=shift.name,
            start_time=shift.start_time,
            end_time=shift.end_time,
            crosses_midnight=shift.crosses_midnight,
            shift_length_min=shift_length_minutes(shift.start_time, shift.end_time),
            grace_min=shift.grace_min,
            half_day_min=shift.half_day_min,
            overtime_min_minutes=shift.overtime_min_minutes,
            is_active=shift.is_active,
            rules_from=current.effective_from if current else None,
            upcoming_rules=ShiftRulesResponse.from_model(upcoming) if upcoming else None,
        )


class WeeklyOffRequest(BaseModel):
    weekday: int = Field(ge=1, le=7)  # ISO: 1 Monday … 7 Sunday
    effective_from: date


class WeeklyOffItem(BaseModel):
    weekday: int
    effective_from: date
    created_at: datetime

    @classmethod
    def from_model(cls, weekly_off: PlantWeeklyOff) -> WeeklyOffItem:
        return cls.model_validate(weekly_off, from_attributes=True)


class WeeklyOffResponse(BaseModel):
    current: WeeklyOffItem | None
    history: list[WeeklyOffItem]


class WeeklyOffCreatedResponse(BaseModel):
    weekly_off: WeeklyOffItem


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
        attendance_start_date=plant.attendance_start_date,
    )
