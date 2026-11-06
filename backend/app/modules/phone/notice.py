"""The phone punching notice the employee accepts on their own phone (M4b spec §7 rule 20).

One file per version and language in app/phone/notice_texts/ (phone-notice-v2.en.txt, .mr.txt,
.hi.txt). A used version is never edited: a change is a new version (and every employee accepts
again), and a test keeps the hash of v1 fixed. v2 (decision 0038) adds the exact GPS sentence and
the face template sentence, so everyone who accepted v1 is asked again. The company address, the
privacy contact and the photo retention days are filled in when shown; the hash of exactly that
filled-in text is stored with the acceptance. The acceptances table is append-only, so the trail
of what was shown can never be changed.
"""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import record_audit
from app.modules.phone.dependencies import PhoneEmployee
from app.modules.phone.models import PhoneNoticeAcceptance
from app.modules.settings.service import get_int_setting, get_text_setting

TEXTS_FOLDER = Path(__file__).resolve().parents[2] / "phone" / "notice_texts"
CURRENT_VERSION = "phone-notice-v2"
DEFAULT_LANGUAGE = "en"
LANGUAGES = ("en", "mr", "hi")


@dataclass(frozen=True)
class NoticeText:
    version: str
    language: str
    text: str  # with the contact, address and retention days filled in
    text_sha256: str


def check_language(language: str) -> str:
    """Only the three known codes reach the disk (no path tricks through `?language=`)."""
    if language not in LANGUAGES:
        raise ApiError("VALIDATION_FAILED", "Choose English, Marathi or Hindi.", 422)
    return language


def raw_notice(version: str = CURRENT_VERSION, language: str = DEFAULT_LANGUAGE) -> str:
    # read_text turns Windows line ends into "\n", so the hash is the same on every computer.
    return (TEXTS_FOLDER / f"{version}.{language}.txt").read_text(encoding="utf-8")


def current_notice(session: Session, language: str = DEFAULT_LANGUAGE) -> NoticeText:
    """The notice exactly as the employee sees it, in the chosen language, or
    PRIVACY_CONTACT_MISSING / COMPANY_ADDRESS_MISSING while Settings are not complete (the same
    rule as the face consent: a DPDP notice must name a real contact and the company address)."""
    check_language(language)
    contact = get_text_setting(session, "privacy_contact").strip()
    address = get_text_setting(session, "company_address").strip()
    if not contact:
        raise ApiError("PRIVACY_CONTACT_MISSING", "Set the privacy contact in Settings first.", 409)
    if not address:
        raise ApiError("COMPANY_ADDRESS_MISSING", "Set the company address in Settings first.", 409)
    filled = (
        raw_notice(CURRENT_VERSION, language)
        .replace("{{privacy_contact}}", contact)
        .replace("{{company_address}}", address)
        .replace("{{retention_days}}", str(get_int_setting(session, "snapshot_retention_days")))
    )
    return NoticeText(
        version=CURRENT_VERSION,
        language=language,
        text=filled,
        text_sha256=hashlib.sha256(filled.encode("utf-8")).hexdigest(),
    )


def acceptance_of(
    session: Session, employee_id: uuid.UUID, version: str = CURRENT_VERSION
) -> PhoneNoticeAcceptance | None:
    return session.scalar(
        select(PhoneNoticeAcceptance).where(
            PhoneNoticeAcceptance.employee_id == employee_id,
            PhoneNoticeAcceptance.version == version,
        )
    )


def notice_required(session: Session, employee_id: uuid.UUID) -> bool:
    return acceptance_of(session, employee_id) is None


def require_notice_accepted(session: Session, employee_id: uuid.UUID) -> None:
    """Punch endpoints (P2) call this first: no punch before "I agree" (AC-18)."""
    if notice_required(session, employee_id):
        raise ApiError(
            "PHONE_NOTICE_REQUIRED",
            "Please read and accept the phone attendance notice first.",
            428,
        )


def accept_notice(
    session: Session,
    caller: PhoneEmployee,
    *,
    version: str,
    text_sha256: str,
    language: str = DEFAULT_LANGUAGE,
) -> datetime:
    """Store "I agree" for the text the employee saw, in the language they saw it. The hash must
    match exactly that text. Saying it twice keeps the first answer."""
    shown = current_notice(session, language)
    if version != shown.version or text_sha256 != shown.text_sha256:
        # The notice (or a value in it) changed after the phone loaded it: show it again.
        raise ApiError("NOTICE_TEXT_CHANGED", "The notice was updated. Please read it again.", 409)
    existing = acceptance_of(session, caller.employee.id, shown.version)
    if existing is not None:
        return existing.accepted_at
    now = utc_now()
    session.add(
        PhoneNoticeAcceptance(
            employee_id=caller.employee.id,
            version=shown.version,
            language=shown.language,
            text_sha256=shown.text_sha256,
            accepted_at=now,
            session_id=caller.phone_session.id,
        )
    )
    record_audit(
        session,
        actor=caller.actor,
        action="phone_notice.accept",
        entity_type="employee",
        entity_id=caller.employee.id,
        after={"version": shown.version, "language": shown.language},
        plant_id=caller.employee.plant_id,
    )
    session.commit()
    return now
