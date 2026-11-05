"""Full data export endpoints (M6 spec section 5). Super Admin only."""

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.exports import service
from app.modules.exports.schemas import FullExportRequest, RecentExport
from app.modules.reports.streaming import delete_file

router = APIRouter(prefix="/exports", tags=["exports"])
super_admin = require(Capability.EXPORT_ALL_DATA)


@router.post("/full", response_class=FileResponse)
def download_full_export(
    body: FullExportRequest,
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> FileResponse:
    built = service.create_full_export(
        session,
        current_user,
        reason=body.reason,
        password=body.password.get_secret_value(),
    )
    return FileResponse(
        built.path,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{built.name}"',
            # Personal data of everyone: no browser or proxy may keep a copy.
            "Cache-Control": "no-store",
        },
        # The file is removed after it was sent (also when the sending fails).
        background=BackgroundTask(delete_file, built.path),
    )


@router.get("/recent", response_model=list[RecentExport])
def list_recent_exports(
    current_user: CurrentUser = Depends(super_admin),
    session: Session = Depends(get_session),
) -> list[RecentExport]:
    return service.recent_exports(session)
