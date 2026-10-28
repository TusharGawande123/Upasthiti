"""Kiosk endpoints (spec §5.5): admin management, the pairing QR and the device's own calls.

Admins: the Super Admin for every plant, a Plant Head for their own plant (the Corporate
Head only reads). Devices: `/kiosk/register` (pairing code) and `/kiosk/me` (signed).
"""

import io
import logging
import re
import uuid

import segno
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.client_ip import get_client_ip
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.time import utc_now
from app.face.engine import FaceEngine
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.auth.rate_limit import report_limiter
from app.modules.auth.scope import ensure_plant_in_scope, plant_filter
from app.modules.face.engine_provider import engine_state, get_face_engine, running_model_id
from app.modules.face.state import common_code_prefixes, plant_has_enrolled_faces
from app.modules.kiosks import service
from app.modules.kiosks.dependencies import require_kiosk
from app.modules.kiosks.models import KioskDevice
from app.modules.kiosks.schemas import (
    CreateKioskRequest,
    KioskFaceSettings,
    KioskFence,
    KioskLocationSettings,
    KioskMeResponse,
    KioskNoticeItem,
    KioskReportRequest,
    KioskResponse,
    KioskScreenSettings,
    KioskWithCodeResponse,
    PlantSummary,
    ReasonRequest,
    RegisterKioskRequest,
    RegisterKioskResponse,
    UpdateKioskRequest,
)
from app.modules.notices.queries import visible_notices
from app.modules.org.geofence_service import current_geofence
from app.modules.org.plants_service import get_plant
from app.modules.settings.service import get_int_setting, get_setting

logger = logging.getLogger(__name__)
router = APIRouter(tags=["kiosks"])
viewer = require(Capability.VIEW_KIOSKS)
manager = require(Capability.MANAGE_KIOSKS)


def _kiosk_in_scope(
    session: Session, current_user: CurrentUser, capability: Capability, kiosk_id: uuid.UUID
) -> KioskDevice:
    kiosk = service.get_kiosk(session, kiosk_id)
    ensure_plant_in_scope(current_user, capability, kiosk.plant_id)
    return kiosk


def _with_code(issued: service.IssuedCode) -> KioskWithCodeResponse:
    return KioskWithCodeResponse(
        kiosk=KioskResponse.from_model(issued.kiosk),
        pairing_code=issued.code,
        code_expires_at=issued.expires_at,
    )


@router.get("/kiosks", response_model=list[KioskResponse])
def list_kiosks(
    plant_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, max_length=10),
    current_user: CurrentUser = Depends(viewer),
    session: Session = Depends(get_session),
) -> list[KioskResponse]:
    kiosks = service.list_kiosks(
        session,
        only_plant_ids=plant_filter(current_user, Capability.VIEW_KIOSKS),
        plant_id=plant_id,
        status=status,
    )
    return [KioskResponse.from_model(kiosk) for kiosk in kiosks]


@router.post("/kiosks", response_model=KioskWithCodeResponse, status_code=201)
def create_kiosk(
    body: CreateKioskRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> KioskWithCodeResponse:
    ensure_plant_in_scope(current_user, Capability.MANAGE_KIOSKS, body.plant_id)
    plant = get_plant(session, body.plant_id)
    return _with_code(
        service.create_kiosk(session, actor=current_user.actor, plant=plant, name=body.name)
    )


@router.post("/kiosks/{kiosk_id}/pairing-code", response_model=KioskWithCodeResponse)
def new_pairing_code(
    kiosk_id: uuid.UUID,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> KioskWithCodeResponse:
    kiosk = _kiosk_in_scope(session, current_user, Capability.MANAGE_KIOSKS, kiosk_id)
    return _with_code(service.reissue_code(session, actor=current_user.actor, kiosk=kiosk))


@router.get("/kiosks/{kiosk_id}/pairing-qr.svg")
def pairing_qr(
    kiosk_id: uuid.UUID,
    request: Request,
    code: str = Query(pattern=r"^[0-9]{6}$"),
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> Response:
    """QR of the pairing link (F-18). It only works while the code is still valid."""
    kiosk = _kiosk_in_scope(session, current_user, Capability.MANAGE_KIOSKS, kiosk_id)
    issue = service.current_pairing_code_issue(session, kiosk)
    if issue is None or issue.code_hash != service.hash_pairing_code(code):
        raise ApiError("PAIRING_CODE_EXPIRED", "This code is no longer valid.", 410)

    origin = get_settings().allowed_origin
    buffer = io.BytesIO()
    segno.make(f"{origin}/attendance?code={code}", error="m").save(
        buffer, kind="svg", scale=8, border=2, xmldecl=False
    )
    return Response(
        content=buffer.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )


@router.patch("/kiosks/{kiosk_id}", response_model=KioskResponse)
def update_kiosk(
    kiosk_id: uuid.UUID,
    body: UpdateKioskRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> KioskResponse:
    kiosk = _kiosk_in_scope(session, current_user, Capability.MANAGE_KIOSKS, kiosk_id)
    return KioskResponse.from_model(
        service.update_kiosk(
            session,
            actor=current_user.actor,
            kiosk=kiosk,
            name=body.name,
            sound_muted=body.sound_muted,
        )
    )


@router.post("/kiosks/{kiosk_id}/revoke", response_model=KioskResponse)
def revoke_kiosk(
    kiosk_id: uuid.UUID,
    body: ReasonRequest,
    current_user: CurrentUser = Depends(manager),
    session: Session = Depends(get_session),
) -> KioskResponse:
    kiosk = _kiosk_in_scope(session, current_user, Capability.MANAGE_KIOSKS, kiosk_id)
    return KioskResponse.from_model(
        service.revoke_kiosk(session, actor=current_user.actor, kiosk=kiosk, reason=body.reason)
    )


# --- The gate device itself ---------------------------------------------------------------


@router.post("/kiosk/register", response_model=RegisterKioskResponse)
def register_kiosk(
    body: RegisterKioskRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> RegisterKioskResponse:
    location = (
        service.Location(body.location.lat, body.location.lon, body.location.accuracy_m)
        if body.location
        else None
    )
    kiosk = service.register_device(
        session,
        pairing_code=body.pairing_code,
        public_key_spki=body.public_key_spki,
        location=location,
        app_version=body.app_version,
        user_agent=request.headers.get("user-agent"),
        ip=get_client_ip(request),
    )
    plant = get_plant(session, kiosk.plant_id)
    return RegisterKioskResponse(
        kiosk_id=kiosk.id,
        kiosk_name=kiosk.name,
        plant=PlantSummary(id=plant.id, name=plant.name, code=plant.code),
        server_time=utc_now(),
    )


@router.get("/kiosk/me", response_model=KioskMeResponse)
def kiosk_me(
    kiosk: KioskDevice = Depends(require_kiosk),
    session: Session = Depends(get_session),
    engine: FaceEngine = Depends(get_face_engine),
) -> KioskMeResponse:
    """The kiosk's heartbeat (every 60 s): who it is, plus the notices and settings it shows."""
    plant = get_plant(session, kiosk.plant_id)
    now = utc_now()
    return KioskMeResponse(
        kiosk_id=kiosk.id,
        kiosk_name=kiosk.name,
        status=kiosk.status,
        plant=PlantSummary(id=plant.id, name=plant.name, code=plant.code),
        server_time=now,
        notices=[
            KioskNoticeItem(
                id=notice.id,
                text=notice.text,
                level=notice.level,
                ends_at=notice.ends_at,
            )
            for notice in visible_notices(session, kiosk.plant_id, now)
        ],
        kiosk_settings=_screen_settings(session, kiosk, engine),
    )


def _screen_settings(
    session: Session, kiosk: KioskDevice, engine: FaceEngine
) -> KioskScreenSettings:
    # A kiosk switched to "sound off" at its own gate silences tones and voice together.
    quiet = kiosk.sound_muted
    return KioskScreenSettings(
        voice_enabled=get_setting(session, "kiosk_voice_enabled") == "on" and not quiet,
        sound_enabled=get_setting(session, "kiosk_sound_enabled") == "on" and not quiet,
        result_seconds=get_int_setting(session, "kiosk_result_seconds"),
        reject_seconds=get_int_setting(session, "kiosk_reject_seconds"),
        photo_ready_seconds=get_int_setting(session, "kiosk_photo_ready_seconds"),
        snapshot_retention_days=get_int_setting(session, "snapshot_retention_days"),
        dark_threshold=get_int_setting(session, "snapshot_dark_threshold"),
        face=KioskFaceSettings(
            available=engine.model_id is not None and get_settings().face_template_key is not None,
            state=engine_state(engine),  # type: ignore[arg-type]
            enabled_for_plant=plant_has_enrolled_faces(session, kiosk.plant_id, running_model_id()),
            challenge_seconds=get_int_setting(session, "face_challenge_seconds"),
            code_entry_seconds=get_int_setting(session, "face_code_entry_seconds"),
            min_yaw_degrees=get_int_setting(session, "face_min_yaw_degrees"),
            code_prefixes=common_code_prefixes(session, kiosk.plant_id, running_model_id()),
        ),
        location=_location_settings(session, kiosk),
    )


def _location_settings(session: Session, kiosk: KioskDevice) -> KioskLocationSettings:
    fence = current_geofence(session, kiosk.plant_id)
    return KioskLocationSettings(
        accuracy_limit_m=get_int_setting(session, "gps_accuracy_limit_m"),
        max_age_seconds=get_int_setting(session, "kiosk_location_max_age_seconds"),
        refresh_seconds=get_int_setting(session, "kiosk_location_refresh_seconds"),
        geofence=None
        if fence is None
        else KioskFence(
            version_id=fence.id,
            shape=fence.shape,  # type: ignore[arg-type]
            geojson=fence.geojson,
            radius_m=float(fence.radius_m) if fence.radius_m is not None else None,
            buffer_m=fence.buffer_m,
        ),
    )


# The kiosk is not trusted: a changed or buggy one could send a card text or a name. Card
# texts are cut out here, and control or direction-changing characters (which can fake log
# lines) are removed.
_CARD_TEXT = re.compile(r"UPS1\.[A-Za-z0-9._-]*")
_UNSAFE_CHARACTERS = re.compile(r"[\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def clean_report_message(message: str) -> str:
    return _UNSAFE_CHARACTERS.sub(" ", _CARD_TEXT.sub("[card]", message))


@router.post("/kiosk/report", status_code=204)
def kiosk_report(
    body: KioskReportRequest,
    kiosk: KioskDevice = Depends(require_kiosk),
) -> Response:
    """A problem the kiosk noticed (camera error, script error...). It goes to the server log
    only, as one JSON line; nothing is stored in the database (S-26)."""
    if not report_limiter.allow(str(kiosk.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many reports. Try again later.", 429)
    logger.warning(
        "kiosk report",
        extra={
            "fields": {
                "kiosk_id": str(kiosk.id),
                "plant_id": str(kiosk.plant_id),
                "kind": body.kind,
                "message": clean_report_message(body.message),
                "count": body.count,
                "app_version": body.app_version,
            }
        },
    )
    return Response(status_code=204)
