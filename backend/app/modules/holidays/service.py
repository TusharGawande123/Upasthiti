"""Holiday calendar: add, cancel and list holidays (M5 spec §5.3, §7 rule 4; decision 0034 line 2).

Only the Super Admin changes the calendar. A holiday is for all plants or chosen plants, paid or
unpaid. Holidays may be added for past dates (e.g. a sudden closure), within one year back; the
affected attendance days are recomputed. Cancelled, never deleted; every change is audited.
"""

import uuid
from collections.abc import Iterable
from datetime import date, timedelta

from sqlalchemy import extract, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules.attendance.service import mark_plant_days_stale
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import plant_filter
from app.modules.holidays.models import Holiday, HolidayPlant
from app.modules.holidays.schemas import (
    Cancellation,
    CreateHolidayRequest,
    HolidayPlantItem,
    HolidayResponse,
)
from app.modules.notices.schemas import NoticePerson as Person
from app.modules.org.models import Plant
from app.modules.users.models import User

DAYS_BACK = 365
DAYS_AHEAD = 2 * 365


def create_holiday(
    session: Session, current_user: CurrentUser, body: CreateHolidayRequest
) -> Holiday:
    _check_date(body.date)
    plant_ids = _chosen_plants(session, body)
    _check_no_holiday_already(session, body.date, plant_ids)
    holiday = Holiday(
        date=body.date,
        name=body.name.strip(),
        is_paid=body.is_paid,
        all_plants=body.all_plants,
        created_by=current_user.user.id,
        created_at=utc_now(),
    )
    session.add(holiday)
    session.flush()
    for plant_id in plant_ids or []:
        session.add(HolidayPlant(holiday_id=holiday.id, plant_id=plant_id))
    record_audit(
        session,
        actor=current_user.actor,
        action="holiday.create",
        entity_type="holiday",
        entity_id=holiday.id,
        after={
            "date": holiday.date,
            "name": holiday.name,
            "is_paid": holiday.is_paid,
            "all_plants": holiday.all_plants,
            "plant_ids": sorted(str(plant_id) for plant_id in plant_ids or []),
        },
    )
    mark_plant_days_stale(session, plant_ids, holiday.date, holiday.date)
    session.commit()
    return holiday


def cancel_holiday(
    session: Session, current_user: CurrentUser, holiday_id: uuid.UUID, reason: str
) -> Holiday:
    holiday = session.get(Holiday, holiday_id, with_for_update=True)
    if holiday is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if not holiday.is_active:
        raise ApiError("HOLIDAY_NOT_ACTIVE", "This holiday is already cancelled.", 409)
    holiday.cancelled_at = utc_now()
    holiday.cancelled_by = current_user.user.id
    holiday.cancel_reason = reason.strip()
    record_audit(
        session,
        actor=current_user.actor,
        action="holiday.cancel",
        entity_type="holiday",
        entity_id=holiday.id,
        before={"cancelled": False},
        after={"cancelled": True, "date": holiday.date},
        reason=holiday.cancel_reason,
    )
    listed = None if holiday.all_plants else _listed_plants(session, holiday.id)
    mark_plant_days_stale(session, listed, holiday.date, holiday.date)
    session.commit()
    return holiday


def list_holidays(
    session: Session,
    current_user: CurrentUser,
    *,
    year: int,
    plant_id: uuid.UUID | None,
    state: str | None,
) -> list[Holiday]:
    """By date. A Plant Head sees the all-plant holidays and those of the own plant."""
    statement = (
        select(Holiday)
        .where(extract("year", Holiday.date) == year)
        .order_by(Holiday.date, Holiday.created_at)
    )
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    plants_to_show = {plant_id} if plant_id else allowed
    if plant_id and allowed is not None and plant_id not in allowed:
        return []
    if plants_to_show is not None:
        listed = select(HolidayPlant.holiday_id).where(HolidayPlant.plant_id.in_(plants_to_show))
        statement = statement.where(or_(Holiday.all_plants.is_(True), Holiday.id.in_(listed)))
    if state == "active":
        statement = statement.where(Holiday.cancelled_at.is_(None))
    elif state == "cancelled":
        statement = statement.where(Holiday.cancelled_at.is_not(None))
    return list(session.scalars(statement))


def present(session: Session, holidays: Iterable[Holiday]) -> list[HolidayResponse]:
    holidays = list(holidays)
    ids = [holiday.id for holiday in holidays]
    plant_rows = session.execute(
        select(HolidayPlant.holiday_id, Plant.id, Plant.code)
        .join(Plant, Plant.id == HolidayPlant.plant_id)
        .where(HolidayPlant.holiday_id.in_(ids))
        .order_by(Plant.code)
    ).all()
    plants_by_holiday: dict[uuid.UUID, list[HolidayPlantItem]] = {}
    for holiday_id, plant_id, code in plant_rows:
        plants_by_holiday.setdefault(holiday_id, []).append(
            HolidayPlantItem(id=plant_id, code=code)
        )
    user_ids = {holiday.created_by for holiday in holidays} | {
        holiday.cancelled_by for holiday in holidays if holiday.cancelled_by
    }
    names = dict(session.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())

    def person(user_id: uuid.UUID) -> Person:
        return Person(id=user_id, name=names.get(user_id, ""))

    return [
        HolidayResponse(
            id=holiday.id,
            date=holiday.date,
            name=holiday.name,
            is_paid=holiday.is_paid,
            all_plants=holiday.all_plants,
            plants=plants_by_holiday.get(holiday.id, []),
            created_by=person(holiday.created_by),
            created_at=holiday.created_at,
            cancelled=Cancellation(
                by=person(holiday.cancelled_by),
                at=holiday.cancelled_at,
                reason=holiday.cancel_reason or "",
            )
            if holiday.cancelled_at and holiday.cancelled_by
            else None,
        )
        for holiday in holidays
    ]


def _listed_plants(session: Session, holiday_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        session.scalars(select(HolidayPlant.plant_id).where(HolidayPlant.holiday_id == holiday_id))
    )


# --- Checks -------------------------------------------------------------------------------------


def _check_date(day: date) -> None:
    today = today_ist()
    if not today - timedelta(days=DAYS_BACK) <= day <= today + timedelta(days=DAYS_AHEAD):
        raise ApiError(
            "HOLIDAY_DATE_INVALID", "Choose a date within the last year or the next two years.", 422
        )


def _chosen_plants(session: Session, body: CreateHolidayRequest) -> list[uuid.UUID] | None:
    """None for an all-plant holiday; otherwise the chosen plants, which must exist."""
    if body.all_plants:
        return None
    chosen = list(dict.fromkeys(body.plant_ids))
    found = set(session.scalars(select(Plant.id).where(Plant.id.in_(chosen))))
    if not chosen or found != set(chosen):
        raise ApiError(
            "VALIDATION_FAILED", "Choose at least one plant.", 422, {"field": "plant_ids"}
        )
    return chosen


def _check_no_holiday_already(
    session: Session, day: date, plant_ids: list[uuid.UUID] | None
) -> None:
    """One holiday per plant and date: an all-plant holiday clashes with every holiday that day."""
    same_day = select(Holiday).where(Holiday.date == day, Holiday.cancelled_at.is_(None))
    if plant_ids is not None:
        listed = select(HolidayPlant.holiday_id).where(HolidayPlant.plant_id.in_(plant_ids))
        same_day = same_day.where(or_(Holiday.all_plants.is_(True), Holiday.id.in_(listed)))
    clash = session.scalars(same_day.limit(1)).first()
    if clash is None:
        return
    clash_codes = _codes_covered(session, clash, plant_ids)
    raise ApiError(
        "HOLIDAY_EXISTS",
        "There is already a holiday on this date for one of these plants.",
        409,
        {"date": day.isoformat(), "holiday_id": str(clash.id), "plant_codes": clash_codes},
    )


def _codes_covered(
    session: Session, clash: Holiday, plant_ids: list[uuid.UUID] | None
) -> list[str]:
    """The plant codes both holidays cover (empty list = all plants)."""
    if clash.all_plants and plant_ids is None:
        return []
    statement = select(Plant.code).order_by(Plant.code)
    if not clash.all_plants:
        listed = select(HolidayPlant.plant_id).where(HolidayPlant.holiday_id == clash.id)
        statement = statement.where(Plant.id.in_(listed))
    if plant_ids is not None:
        statement = statement.where(Plant.id.in_(plant_ids))
    return list(session.scalars(statement))
