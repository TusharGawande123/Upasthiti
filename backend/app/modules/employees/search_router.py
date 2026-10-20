"""Quick search for the Ctrl+K palette (F-6): employees (by code, name or QR card serial),
plants and kiosks, within the user's plant scope. At least 2 characters."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, get_current_user
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees import queries
from app.modules.employees.schemas import (
    SearchEmployee,
    SearchKiosk,
    SearchPlant,
    SearchResponse,
)
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant

router = APIRouter(tags=["search"])
SMALL_LIMIT = 5


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(min_length=2, max_length=60),
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SearchResponse:
    text = q.strip()
    employees = queries.search(
        session, text, only_plant_ids=plant_filter(current_user, Capability.VIEW_EMPLOYEES)
    )
    plant_scope = plant_filter(current_user, Capability.VIEW_PLANT_SETUP)
    plants_query = select(Plant).where(
        or_(func.lower(Plant.name).contains(text.lower()), Plant.code.startswith(text.upper()))
    )
    if plant_scope is not None:
        plants_query = plants_query.where(Plant.id.in_(plant_scope))
    kiosk_scope = plant_filter(current_user, Capability.VIEW_KIOSKS)
    kiosks_query = select(KioskDevice).where(func.lower(KioskDevice.name).contains(text.lower()))
    if kiosk_scope is not None:
        kiosks_query = kiosks_query.where(KioskDevice.plant_id.in_(kiosk_scope))

    plant_codes = dict(session.execute(select(Plant.id, Plant.code)).all())
    card_serials = queries.matching_card_serials(
        session, text, [employee.id for employee in employees]
    )
    return SearchResponse(
        employees=[
            SearchEmployee(
                id=employee.id,
                employee_code=employee.employee_code,
                full_name=employee.full_name,
                plant_code=plant_codes.get(employee.plant_id, ""),
                status=employee.status,
                card_serial=card_serials.get(employee.id),
            )
            for employee in employees
        ],
        plants=[
            SearchPlant(id=plant.id, code=plant.code, name=plant.name)
            for plant in session.scalars(plants_query.order_by(Plant.code).limit(SMALL_LIMIT))
        ],
        kiosks=[
            SearchKiosk(id=kiosk.id, name=kiosk.name, plant_id=kiosk.plant_id)
            for kiosk in session.scalars(kiosks_query.order_by(KioskDevice.name).limit(SMALL_LIMIT))
        ],
    )
