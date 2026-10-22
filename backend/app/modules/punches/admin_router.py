"""The admin punch log (spec M2 §5.3): list, day summary, one punch, its photo, photo
comparison and the Excel export. Read-only: punches are never changed (append-only table).

Super Admin and Corporate Head see every plant, a Plant Head the punches made at kiosks of their
own plant. Photos and the comparison are for the Super Admin only (decision 0009).
"""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, fetch_page, page_params
from app.core.time import today_ist
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import ensure_plant_in_scope, plant_filter
from app.modules.org.plants_service import get_plant
from app.modules.punches import admin_service, presenter, queries
from app.modules.punches.schemas import (
    PunchCompareResponse,
    PunchDetail,
    PunchLogItem,
    PunchSummaryResponse,
)

router = APIRouter(tags=["punches"])
viewer = require(Capability.VIEW_PUNCHES)
exporter = require(Capability.EXPORT_PUNCHES)
photo_viewer = require(Capability.VIEW_SNAPSHOTS)


def punch_filters(
    day: date | None = Query(default=None, alias="date"),
    plant_id: uuid.UUID | None = None,
    decision: Literal["accepted", "rejected"] | None = None,
    kiosk_id: uuid.UUID | None = None,
    employee_id: uuid.UUID | None = None,
    reason_code: str | None = Query(default=None, max_length=40),
    dark_only: bool = False,
    q: str | None = Query(default=None, max_length=60),
) -> queries.PunchFilters:
    return queries.PunchFilters(
        day=day or today_ist(),
        plant_id=plant_id,
        decision=decision,
        kiosk_id=kiosk_id,
        employee_id=employee_id,
        reason_code=reason_code,
        dark_only=dark_only,
        search=q or None,
    )


def _viewer(current_user: CurrentUser, capability: Capability) -> presenter.Viewer:
    return presenter.Viewer(
        only_plant_ids=plant_filter(current_user, capability),
        sees_dark_photos=current_user.access(Capability.VIEW_SNAPSHOTS) is not None,
    )


def _scoped(
    filters: queries.PunchFilters, current_user: CurrentUser, capability: Capability
) -> tuple[queries.PunchFilters, presenter.Viewer]:
    who = _viewer(current_user, capability)
    if filters.plant_id is not None:
        ensure_plant_in_scope(current_user, capability, filters.plant_id)
    # "Dark photos only" is a Super Admin filter; for others it is ignored.
    if filters.dark_only and not who.sees_dark_photos:
        filters = queries.PunchFilters(**{**filters.__dict__, "dark_only": False})
    return filters, who


@router.get("/punches", response_model=Page[PunchLogItem])
def list_punches(
    params: PageParams = Depends(page_params),
    filters: queries.PunchFilters = Depends(punch_filters),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> Page[PunchLogItem]:
    filters, who = _scoped(filters, current_user, Capability.VIEW_PUNCHES)
    statement = queries.punches_statement(filters, who.only_plant_ids)
    rows, total = fetch_page(session, statement, params)
    return Page(
        items=presenter.punch_items(session, rows, who),
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


@router.get("/punches/summary", response_model=PunchSummaryResponse)
def punches_summary(
    filters: queries.PunchFilters = Depends(punch_filters),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> PunchSummaryResponse:
    # The chips count the whole day and plant, whatever the other filters say.
    day_only = queries.PunchFilters(day=filters.day, plant_id=filters.plant_id)
    day_only, who = _scoped(day_only, current_user, Capability.VIEW_PUNCHES)
    summary = queries.day_summary(session, queries.punches_statement(day_only, who.only_plant_ids))
    return PunchSummaryResponse(
        accepted_in=summary.accepted_in,
        accepted_out=summary.accepted_out,
        rejected=summary.rejected,
        dark_photos=summary.dark_photos if who.sees_dark_photos else None,
        rejected_by_reason=summary.rejected_by_reason,
    )


@router.get("/punches/export.xlsx")
def export_punches(
    filters: queries.PunchFilters = Depends(punch_filters),
    current_user: CurrentUser = Depends(exporter),
    session: Session = Depends(get_session),
) -> Response:
    filters, who = _scoped(filters, current_user, Capability.EXPORT_PUNCHES)
    statement = queries.punches_statement(filters, who.only_plant_ids)
    # One more than allowed is enough to know the file would be too big.
    rows = list(session.scalars(statement.limit(admin_service.MAX_EXPORT_ROWS + 1)))
    plant_code = get_plant(session, filters.plant_id).code if filters.plant_id else None
    exported = admin_service.build_export(
        presenter.punch_items(session, rows, who), filters.day, plant_code
    )
    audit_filters = {
        key: str(value) for key, value in filters.__dict__.items() if value not in (None, False)
    }
    admin_service.record_export(
        session, current_user.actor, audit_filters, exported.rows, filters.plant_id
    )
    return Response(
        content=exported.content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{exported.file_name}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/punches/{punch_id}", response_model=PunchDetail)
def get_punch(
    punch_id: uuid.UUID,
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> PunchDetail:
    who = _viewer(current_user, Capability.VIEW_PUNCHES)
    punch = queries.get_punch_in_scope(session, punch_id, who.only_plant_ids)
    return presenter.punch_detail(session, punch, who)


@router.get("/punches/{punch_id}/snapshot")
def get_punch_snapshot(
    punch_id: uuid.UUID,
    current_user: CurrentUser = Depends(photo_viewer),
    session: Session = Depends(get_session),
) -> Response:
    punch = queries.get_punch_in_scope(session, punch_id, None)
    jpeg = admin_service.read_snapshot(session, current_user.actor, punch)
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        # Never kept by the browser or a proxy: the next view is fetched (and audited) again.
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
    )


@router.get("/punches/{punch_id}/compare", response_model=PunchCompareResponse)
def compare_punch_photos(
    punch_id: uuid.UUID,
    current_user: CurrentUser = Depends(photo_viewer),
    session: Session = Depends(get_session),
) -> PunchCompareResponse:
    who = _viewer(current_user, Capability.VIEW_SNAPSHOTS)
    punch = queries.get_punch_in_scope(session, punch_id, None)
    items = presenter.punch_items(
        session, [punch, *queries.earlier_photos_of_card(session, punch)], who
    )
    return PunchCompareResponse(current=items[0], earlier=items[1:])
