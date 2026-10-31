"""Response shapes of the live dashboard, the muster and the punctuality analytics
(M5 spec §5.4)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class DashPlant(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_demo: bool


class ContractorCount(BaseModel):
    contractor: dict[str, object] | None  # {id, name} or None = "No contractor"
    inside: int


class ShiftLine(BaseModel):
    shift: dict[str, object]
    expected: int
    arrived: int
    late: int


class Undecided(BaseModel):
    short_hours: int = 0
    incomplete: int = 0


class PlantNumbers(BaseModel):
    inside_now: int = 0
    inside_temporary: int = 0
    expected: int = 0
    arrived: int = 0
    late: int = 0
    not_arrived: int = 0
    on_leave: int = 0
    off_today: int = 0
    exceptions: int = 0
    undecided: Undecided = Undecided()


class PlantLive(PlantNumbers):
    plant: DashPlant
    attendance_started: bool
    by_contractor: list[ContractorCount]
    shifts: list[ShiftLine]


class LiveResponse(BaseModel):
    generated_at: datetime
    date: date
    plants: list[PlantLive]
    totals: PlantNumbers


class MusterPerson(BaseModel):
    employee: dict[str, object]
    in_time: datetime
    kiosk: dict[str, object] | None


class MusterPlant(BaseModel):
    plant: DashPlant
    count: int
    people: list[MusterPerson]


class MusterResponse(BaseModel):
    generated_at: datetime
    plants: list[MusterPlant]


class PunctualityGroup(BaseModel):
    key: str
    label: str
    arrivals: int
    late_count: int
    on_time_percent: float
    average_late_min: float


class WeekPoint(BaseModel):
    week_start: date
    on_time_percent: float


class TopLate(BaseModel):
    employee: dict[str, object]
    late_count: int
    late_min: int


class PunctualityResponse(BaseModel):
    on_time_percent: float
    arrivals: int
    late_count: int
    average_late_min: float
    early_exit_count: int
    weekly: list[WeekPoint]
    groups: list[PunctualityGroup]
    top_late: list[TopLate]
