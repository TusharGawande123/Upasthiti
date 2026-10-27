"""The public privacy page needs a few settings without a login (spec M3 §8.1, decision 0020).

Only four values leave here: the company address, the privacy contact, the days a photo is kept
and the version of the consent text. No personal data, nothing else from the settings.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.modules.face.consent_texts import CURRENT_VERSION
from app.modules.settings.service import get_int_setting, get_text_setting

router = APIRouter(tags=["privacy"])


class PrivacyNoticeResponse(BaseModel):
    company_address: str  # empty until the Super Admin sets it
    privacy_contact: str  # empty until the Super Admin sets it
    retention_days: int
    consent_version: str


@router.get("/privacy-notice", response_model=PrivacyNoticeResponse)
def read_privacy_notice(session: Session = Depends(get_session)) -> PrivacyNoticeResponse:
    return PrivacyNoticeResponse(
        company_address=get_text_setting(session, "company_address"),
        privacy_contact=get_text_setting(session, "privacy_contact"),
        retention_days=get_int_setting(session, "snapshot_retention_days"),
        consent_version=CURRENT_VERSION,
    )
