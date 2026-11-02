"""Dashboard, muster and punctuality endpoints (M5 spec §5.4). Everyone in scope reads."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.rate_limit import report_limiter
from app.modules.dashboard import service
from app.modules.dashboard.muster_pdf import build_muster_pdf, muster_file_name
from app.modules.dashboard.schemas import LiveResponse, MusterResponse, PunctualityResponse
from app.modules.org.models import Plant

router = APIRouter(tags=["dashboard"])
reader = require(Capability.VIEW_ATTENDANCE)


@router.get("/dashboard/live", response_model=LiveResponse)
def dashboard_live(
    plant_id: uuid.UUID | None = None,
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> LiveResponse:
    """The numbers of today, polled every 30 seconds by the screen (not a long-lived stream)."""
    return service.live(
        session, current_user, plant_id=plant_id, include_demo=include_demo, now=utc_now()
    )


@router.get("/muster", response_model=MusterResponse)
def muster(
    plant_id: uuid.UUID | None = None,
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> MusterResponse:
    return service.muster(
        session, current_user, plant_id=plant_id, include_demo=include_demo, now=utc_now()
    )


@router.get("/muster.pdf")
def muster_pdf(
    plant_id: uuid.UUID | None = None,
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Response:
    if not report_limiter.allow(f"muster:{current_user.id}"):
        raise ApiError("TOO_MANY_REQUESTS", "Too many downloads. Wait a moment.", 429)
    now = utc_now()
    data = service.muster(
        session, current_user, plant_id=plant_id, include_demo=include_demo, now=now
    )
    chosen = session.get(Plant, plant_id) if plant_id else None
    plant_code = chosen.code if chosen else None
    content = build_muster_pdf(data, current_user.user.name)
    record_audit(
        session,
        actor=current_user.actor,
        action="muster.download",
        entity_type="muster",
        # Counts only: no names (spec §7 rule 17).
        after={
            "plant_code": plant_code,
            "count": sum(item.count for item in data.plants),
        },
    )
    session.commit()
    name = muster_file_name(plant_code, now)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/insights/punctuality", response_model=PunctualityResponse)
def punctuality(
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None = None,
    group_by: Literal["department", "category", "shift", "weekday"] = Query(default="department"),
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> PunctualityResponse:
    return service.punctuality(
        session,
        current_user,
        date_from=date_from,
        date_to=date_to,
        plant_id=plant_id,
        group_by=group_by,
        include_demo=include_demo,
    )
