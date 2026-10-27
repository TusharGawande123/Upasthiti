"""Settings endpoints: everyone logged in can read, only the Super Admin can change (spec §5.2)."""

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.settings import service
from app.modules.settings.definitions import SettingValueType

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingResponse(BaseModel):
    key: str
    group: str
    value: SettingValueType
    default: SettingValueType
    unit: str
    used_from: int
    editable: bool
    minimum: float | None
    maximum: float | None
    allowed_values: list[SettingValueType] | None
    is_text: bool = False  # a text setting: minimum and maximum are its length
    report_value: float | None = None  # suggested by the accuracy report (M3)


class SettingsResponse(BaseModel):
    settings: list[SettingResponse]


class UpdateSettingsRequest(BaseModel):
    values: dict[str, Any] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=500)


def to_response(current: list[service.CurrentSetting]) -> SettingsResponse:
    return SettingsResponse(
        settings=[
            SettingResponse(
                key=item.definition.key,
                group=item.definition.group,
                value=item.value,
                default=item.definition.default,
                unit=item.definition.unit,
                used_from=item.definition.used_from,
                editable=item.definition.is_editable,
                minimum=item.definition.minimum,
                maximum=item.definition.maximum,
                allowed_values=list(item.definition.allowed_values)
                if item.definition.allowed_values
                else None,
                is_text=item.definition.is_text,
                report_value=item.definition.report_value,
            )
            for item in current
        ]
    )


@router.get("", response_model=SettingsResponse)
def read_settings(
    _: CurrentUser = Depends(require(Capability.VIEW_SETTINGS)),
    session: Session = Depends(get_session),
) -> SettingsResponse:
    return to_response(service.list_settings(session))


@router.put("", response_model=SettingsResponse)
def change_settings(
    body: UpdateSettingsRequest,
    current_user: CurrentUser = Depends(require(Capability.EDIT_SETTINGS)),
    session: Session = Depends(get_session),
) -> SettingsResponse:
    updated = service.update_settings(
        session, actor=current_user.actor, new_values=body.values, reason=body.reason
    )
    return to_response(updated)
