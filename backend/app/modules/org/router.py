"""Organisation setup endpoints (spec §5.2): plants, setup wizard, readiness, geofence,
departments, shifts and employee categories; since M5 also shift rule versions, the weekly off
and the attendance start date (M5 spec §5.3).

Reading follows the plant scope (a Plant Head sees only their plant); every change is
Super Admin only (decision 0005).
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, page_params
from app.core.time import today_ist
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import ensure_plant_in_scope, plant_filter
from app.modules.org import (
    geofence_service,
    plants_service,
    readiness_service,
    shift_rules_service,
)
from app.modules.org import setup_items_service as items
from app.modules.org.models import Department, EmployeeCategory, Plant, Shift
from app.modules.org.schemas import (
    ClientPlantsResponse,
    CreatePlantRequest,
    CreateShiftRequest,
    GeofenceRequest,
    GeofenceResponse,
    NamedItemRequest,
    NamedItemResponse,
    PlantResponse,
    ReadinessResponse,
    ReasonRequest,
    SetupStatusResponse,
    SetupStepResponse,
    ShiftResponse,
    ShiftRulesResponse,
    UpdatePlantRequest,
    UpdateShiftRequest,
    WeeklyOffCreatedResponse,
    WeeklyOffItem,
    WeeklyOffRequest,
    WeeklyOffResponse,
    plant_response,
)

router = APIRouter(tags=["organisation"])
viewer = require(Capability.VIEW_PLANT_SETUP)
editor = require(Capability.EDIT_PLANT_SETUP)
plant_manager = require(Capability.MANAGE_PLANTS)


def _visible_plant(session: Session, current_user: CurrentUser, plant_id: uuid.UUID) -> Plant:
    ensure_plant_in_scope(current_user, Capability.VIEW_PLANT_SETUP, plant_id)
    return plants_service.get_plant(session, plant_id)


def _to_plant_response(session: Session, plant: Plant) -> PlantResponse:
    readiness = readiness_service.plant_readiness(session, plant.id)
    return plant_response(
        plant,
        geofence_set=readiness.geofence,
        kiosks=readiness.active_kiosks,
        employees=readiness.active_employees,
    )


# --- Plants ---


@router.get("/plants", response_model=Page[PlantResponse])
def list_plants(
    is_active: bool | None = None,
    q: str | None = Query(default=None, max_length=100),
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> Page[PlantResponse]:
    plants, total = plants_service.list_plants(
        session,
        params,
        only_plant_ids=plant_filter(current_user, Capability.VIEW_PLANT_SETUP),
        is_active=is_active,
        search=q,
    )
    return Page(
        items=[_to_plant_response(session, plant) for plant in plants],
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.post("/plants", response_model=PlantResponse, status_code=201)
def create_plant(
    body: CreatePlantRequest,
    current_user: CurrentUser = Depends(plant_manager),
    session: Session = Depends(get_session),
) -> PlantResponse:
    plant = plants_service.create_plant(
        session,
        actor=current_user.actor,
        name=body.name,
        code=body.code,
        address=body.address,
        lat=body.lat,
        lon=body.lon,
    )
    return _to_plant_response(session, plant)


@router.get("/plants/{plant_id}", response_model=PlantResponse)
def get_plant(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> PlantResponse:
    return _to_plant_response(session, _visible_plant(session, current_user, plant_id))


@router.patch("/plants/{plant_id}", response_model=PlantResponse)
def update_plant(
    plant_id: uuid.UUID,
    body: UpdatePlantRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> PlantResponse:
    plant = plants_service.update_plant(
        session,
        actor=current_user.actor,
        plant=plants_service.get_plant(session, plant_id),
        name=body.name,
        address=body.address,
        lat=body.lat,
        lon=body.lon,
        position_given="lat" in body.model_fields_set or "lon" in body.model_fields_set,
        attendance_start_date=body.attendance_start_date,
    )
    return _to_plant_response(session, plant)


@router.post("/plants/{plant_id}/deactivate", response_model=PlantResponse)
def deactivate_plant(
    plant_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(plant_manager),
    session: Session = Depends(get_session),
) -> PlantResponse:
    plant = plants_service.set_plant_active(
        session,
        actor=current_user.actor,
        plant=plants_service.get_plant(session, plant_id),
        active=False,
        reason=body.reason,
    )
    return _to_plant_response(session, plant)


@router.post("/plants/{plant_id}/reactivate", response_model=PlantResponse)
def reactivate_plant(
    plant_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(plant_manager),
    session: Session = Depends(get_session),
) -> PlantResponse:
    plant = plants_service.set_plant_active(
        session,
        actor=current_user.actor,
        plant=plants_service.get_plant(session, plant_id),
        active=True,
        reason=body.reason,
    )
    return _to_plant_response(session, plant)


@router.get("/plants/{plant_id}/readiness", response_model=ReadinessResponse)
def plant_readiness(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> ReadinessResponse:
    _visible_plant(session, current_user, plant_id)
    readiness = readiness_service.plant_readiness(session, plant_id)
    return ReadinessResponse(
        plant_id=readiness.plant_id,
        geofence=readiness.geofence,
        active_shifts=readiness.active_shifts,
        active_categories=readiness.active_categories,
        active_kiosks=readiness.active_kiosks,
        active_employees=readiness.active_employees,
        ready=readiness.ready,
        device_online=readiness.device_online,
        location_good=readiness.location_good,
        attendance_start_set=readiness.attendance_start_set,
        weekly_off_set=readiness.weekly_off_set,
    )


# --- Setup wizard (F-5) ---------------------------------------------------------------------------


@router.post("/setup/client-plants", response_model=ClientPlantsResponse)
def add_client_plants(
    current_user: CurrentUser = Depends(plant_manager),
    session: Session = Depends(get_session),
) -> ClientPlantsResponse:
    created, skipped = plants_service.add_client_plants(session, actor=current_user.actor)
    return ClientPlantsResponse(created=created, skipped=skipped)


@router.get("/setup/status", response_model=SetupStatusResponse)
def setup_status(
    _: CurrentUser = Depends(plant_manager),
    session: Session = Depends(get_session),
) -> SetupStatusResponse:
    steps = readiness_service.setup_status(session)
    return SetupStatusResponse(
        steps=[SetupStepResponse(key=step.key, done=step.done) for step in steps]
    )


# --- Geofence ---


@router.get("/plants/{plant_id}/geofence", response_model=GeofenceResponse)
def get_geofence(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> GeofenceResponse:
    _visible_plant(session, current_user, plant_id)
    return GeofenceResponse.from_model(geofence_service.require_current_geofence(session, plant_id))


@router.get("/plants/{plant_id}/geofence/versions", response_model=list[GeofenceResponse])
def list_geofence_versions(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[GeofenceResponse]:
    _visible_plant(session, current_user, plant_id)
    return [
        GeofenceResponse.from_model(geofence)
        for geofence in geofence_service.geofence_versions(session, plant_id)
    ]


@router.put("/plants/{plant_id}/geofence", response_model=GeofenceResponse)
def save_geofence(
    plant_id: uuid.UUID,
    body: GeofenceRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> GeofenceResponse:
    geofence = geofence_service.save_geofence(
        session,
        actor=current_user.actor,
        plant=plants_service.get_plant(session, plant_id),
        shape=body.shape,
        geojson=body.geojson,
        radius_m=body.radius_m,
        buffer_m=body.buffer_m,
        reason=body.reason,
    )
    return GeofenceResponse.from_model(geofence)


# --- Departments and categories (same shape: a name per plant) ---


def _list_named(
    session: Session,
    current_user: CurrentUser,
    model: type[Department] | type[EmployeeCategory],
    plant_id: uuid.UUID,
) -> list[NamedItemResponse]:
    _visible_plant(session, current_user, plant_id)
    return [
        NamedItemResponse.from_model(item) for item in items.list_items(session, model, plant_id)
    ]


def _create_named(
    session: Session,
    current_user: CurrentUser,
    model: type[Department] | type[EmployeeCategory],
    plant_id: uuid.UUID,
    name: str,
) -> NamedItemResponse:
    plants_service.get_plant(session, plant_id)
    item = items.create_named_item(
        session, actor=current_user.actor, model=model, plant_id=plant_id, name=name
    )
    return NamedItemResponse.from_model(item)


def _rename_named(
    session: Session,
    current_user: CurrentUser,
    model: type[Department] | type[EmployeeCategory],
    item_id: uuid.UUID,
    name: str,
) -> NamedItemResponse:
    item = items.get_item(session, model, item_id)
    renamed = items.rename_item(session, actor=current_user.actor, item=item, name=name)
    return NamedItemResponse.from_model(renamed)


def _set_named_active(
    session: Session,
    current_user: CurrentUser,
    model: type[Department] | type[EmployeeCategory],
    item_id: uuid.UUID,
    active: bool,
    reason: str,
) -> NamedItemResponse:
    item = items.get_item(session, model, item_id)
    items.set_item_active(
        session, actor=current_user.actor, item=item, active=active, reason=reason
    )
    return NamedItemResponse.from_model(item)


@router.get("/plants/{plant_id}/departments", response_model=list[NamedItemResponse])
def list_departments(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[NamedItemResponse]:
    return _list_named(session, current_user, Department, plant_id)


@router.post("/plants/{plant_id}/departments", response_model=NamedItemResponse, status_code=201)
def create_department(
    plant_id: uuid.UUID,
    body: NamedItemRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _create_named(session, current_user, Department, plant_id, body.name)


@router.patch("/departments/{item_id}", response_model=NamedItemResponse)
def rename_department(
    item_id: uuid.UUID,
    body: NamedItemRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _rename_named(session, current_user, Department, item_id, body.name)


@router.post("/departments/{item_id}/deactivate", response_model=NamedItemResponse)
def deactivate_department(
    item_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _set_named_active(session, current_user, Department, item_id, False, body.reason)


@router.post("/departments/{item_id}/reactivate", response_model=NamedItemResponse)
def reactivate_department(
    item_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _set_named_active(session, current_user, Department, item_id, True, body.reason)


@router.get("/plants/{plant_id}/categories", response_model=list[NamedItemResponse])
def list_categories(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[NamedItemResponse]:
    return _list_named(session, current_user, EmployeeCategory, plant_id)


@router.post("/plants/{plant_id}/categories", response_model=NamedItemResponse, status_code=201)
def create_category(
    plant_id: uuid.UUID,
    body: NamedItemRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _create_named(session, current_user, EmployeeCategory, plant_id, body.name)


@router.patch("/categories/{item_id}", response_model=NamedItemResponse)
def rename_category(
    item_id: uuid.UUID,
    body: NamedItemRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _rename_named(session, current_user, EmployeeCategory, item_id, body.name)


@router.post("/categories/{item_id}/deactivate", response_model=NamedItemResponse)
def deactivate_category(
    item_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _set_named_active(session, current_user, EmployeeCategory, item_id, False, body.reason)


@router.post("/categories/{item_id}/reactivate", response_model=NamedItemResponse)
def reactivate_category(
    item_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> NamedItemResponse:
    return _set_named_active(session, current_user, EmployeeCategory, item_id, True, body.reason)


# --- Shifts ---


def _shift_response(session: Session, shift: Shift) -> ShiftResponse:
    today = today_ist()
    return ShiftResponse.from_model(
        shift,
        current=shift_rules_service.rule_version_on(session, shift.id, today),
        upcoming=shift_rules_service.upcoming_rule_version(session, shift.id, today),
    )


@router.get("/plants/{plant_id}/shifts", response_model=list[ShiftResponse])
def list_shifts(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[ShiftResponse]:
    _visible_plant(session, current_user, plant_id)
    return [_shift_response(session, shift) for shift in items.list_items(session, Shift, plant_id)]


@router.post("/plants/{plant_id}/shifts", response_model=ShiftResponse, status_code=201)
def create_shift(
    plant_id: uuid.UUID,
    body: CreateShiftRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> ShiftResponse:
    plants_service.get_plant(session, plant_id)
    shift = items.create_shift(
        session,
        actor=current_user.actor,
        plant_id=plant_id,
        name=body.name,
        rules=shift_rules_service.ShiftRules(
            start_time=body.start_time,
            end_time=body.end_time,
            grace_min=body.grace_min,
            half_day_min=body.half_day_min,
            overtime_min_minutes=body.overtime_min_minutes,
        ),
    )
    return _shift_response(session, shift)


@router.patch("/shifts/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: uuid.UUID,
    body: UpdateShiftRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> ShiftResponse:
    shift = items.get_item(session, Shift, shift_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    rules_effective_from = changes.pop("rules_effective_from", None)
    shift = items.update_shift(
        session,
        actor=current_user.actor,
        shift=shift,
        changes=changes,
        rules_effective_from=rules_effective_from,
    )
    return _shift_response(session, shift)


@router.get("/shifts/{shift_id}/rule-versions", response_model=list[ShiftRulesResponse])
def list_shift_rule_versions(
    shift_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[ShiftRulesResponse]:
    shift = items.get_item(session, Shift, shift_id)
    _visible_plant(session, current_user, shift.plant_id)
    return [
        ShiftRulesResponse.from_model(version)
        for version in shift_rules_service.list_rule_versions(session, shift.id)
    ]


@router.post("/shifts/{shift_id}/deactivate", response_model=ShiftResponse)
def deactivate_shift(
    shift_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> ShiftResponse:
    shift = items.get_item(session, Shift, shift_id)
    items.set_item_active(
        session, actor=current_user.actor, item=shift, active=False, reason=body.reason
    )
    return _shift_response(session, shift)


@router.post("/shifts/{shift_id}/reactivate", response_model=ShiftResponse)
def reactivate_shift(
    shift_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> ShiftResponse:
    shift = items.get_item(session, Shift, shift_id)
    items.set_item_active(
        session, actor=current_user.actor, item=shift, active=True, reason=body.reason
    )
    return _shift_response(session, shift)


# --- Weekly off (M5) ---


def _weekly_off_response(session: Session, plant_id: uuid.UUID) -> WeeklyOffResponse:
    current = shift_rules_service.weekly_off_on(session, plant_id, today_ist())
    return WeeklyOffResponse(
        current=WeeklyOffItem.from_model(current) if current else None,
        history=[
            WeeklyOffItem.from_model(item)
            for item in shift_rules_service.list_weekly_offs(session, plant_id)
        ],
    )


@router.get("/plants/{plant_id}/weekly-off", response_model=WeeklyOffResponse)
def get_weekly_off(
    plant_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> WeeklyOffResponse:
    _visible_plant(session, current_user, plant_id)
    return _weekly_off_response(session, plant_id)


@router.post(
    "/plants/{plant_id}/weekly-off", response_model=WeeklyOffCreatedResponse, status_code=201
)
def set_weekly_off(
    plant_id: uuid.UUID,
    body: WeeklyOffRequest,
    current_user: CurrentUser = Depends(editor),
    session: Session = Depends(get_session),
) -> WeeklyOffCreatedResponse:
    weekly_off = shift_rules_service.set_weekly_off(
        session,
        actor=current_user.actor,
        plant=plants_service.get_plant(session, plant_id),
        weekday=body.weekday,
        effective_from=body.effective_from,
    )
    return WeeklyOffCreatedResponse(weekly_off=WeeklyOffItem.from_model(weekly_off))
