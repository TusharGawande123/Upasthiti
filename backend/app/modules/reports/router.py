"""The report download endpoint (M5 spec §5.5): GET /reports/{kind}.{format}."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.reports import range_reports, service
from app.modules.reports.streaming import delete_file

router = APIRouter(tags=["reports"])
reader = require(Capability.VIEW_ATTENDANCE)


@router.get("/reports/{kind}.{file_format}")
def download_report(
    kind: str,
    file_format: str,
    plant_id: uuid.UUID | None = None,
    day: date | None = Query(default=None, alias="date"),
    month: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    contractor_id: uuid.UUID | None = None,
    employee_id: uuid.UUID | None = None,
    type: str | None = Query(default=None, pattern="^(permanent|temporary)$"),  # noqa: A002
    department_id: uuid.UUID | None = None,
    include_demo: bool = False,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Response:
    """One report as Excel or PDF. A day is `date`, a month is `month` (2026-10)."""
    if kind in ("register-range", "employee-range"):
        return _range_response(
            session,
            current_user,
            range_reports.RangeRequest(
                kind=kind,
                format=file_format,
                plant_id=plant_id,
                employee_id=employee_id,
                date_from=date_from,
                date_to=date_to,
                employee_type=type,
                department_id=department_id,
                include_demo=include_demo,
            ),
        )
    request = service.Request(
        kind=kind,
        format=file_format,
        plant_id=plant_id,
        day=day,
        month=month,
        date_from=date_from,
        date_to=date_to,
        contractor_id=contractor_id,
        include_demo=include_demo,
    )
    file = service.build_file(session, current_user, request)
    return Response(
        content=file.content,
        media_type=file.media_type,
        headers={"Content-Disposition": f'attachment; filename="{file.name}"'},
    )


def _range_response(
    session: Session, current_user: CurrentUser, request: range_reports.RangeRequest
) -> Response:
    """A range report: bytes, or a temporary file that is removed after it has been sent."""
    file = range_reports.build_range_file(session, current_user, request)
    headers = {"Content-Disposition": f'attachment; filename="{file.name}"'}
    if file.path is not None:
        return FileResponse(
            file.path,
            media_type=file.media_type,
            headers=headers,
            background=BackgroundTask(delete_file, file.path),
        )
    return Response(content=file.content or b"", media_type=file.media_type, headers=headers)
