"""The face consent text the employee reads (spec M3 §7 rule 3, §8.1).

One file per version and language in app/face/consent_texts/ (face-consent-v1.en.txt, .mr.txt,
.hi.txt). A used version is never edited: a change is a new version, and a test keeps the hash
of v1 fixed. When shown, the company address, the privacy contact and the photo retention days
are filled in; the hash of exactly that filled-in text is saved with the consent.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.settings.service import get_int_setting, get_text_setting

TEXTS_FOLDER = Path(__file__).resolve().parents[2] / "face" / "consent_texts"
CURRENT_VERSION = "face-consent-v1"
VERSIONS = ("face-consent-v1",)
LANGUAGES = ("en", "mr", "hi")


@dataclass(frozen=True)
class ConsentText:
    version: str
    language: str
    text: str  # with the contact, address and retention days filled in
    text_sha256: str


def raw_text(version: str, language: str) -> str:
    """The file as written (placeholders still in it). Only known names reach the disk."""
    if version not in VERSIONS or language not in LANGUAGES:
        raise ApiError("CONSENT_TEXT_UNKNOWN", "This consent text does not exist.", 404)
    # read_text turns Windows line ends into "\n", so the hash is the same on every computer.
    return (TEXTS_FOLDER / f"{version}.{language}.txt").read_text(encoding="utf-8")


def consent_text(session: Session, version: str, language: str) -> ConsentText:
    """The text exactly as the employee sees it, or an error when Settings are not complete."""
    template = raw_text(version, language)
    contact = get_text_setting(session, "privacy_contact").strip()
    address = get_text_setting(session, "company_address").strip()
    # The text must name a real contact and the company address (DPDP notice), so consent
    # cannot be recorded until both are set.
    if not contact:
        raise ApiError("PRIVACY_CONTACT_MISSING", "Set the privacy contact in Settings first.", 409)
    if not address:
        raise ApiError("COMPANY_ADDRESS_MISSING", "Set the company address in Settings first.", 409)
    filled = (
        template.replace("{{privacy_contact}}", contact)
        .replace("{{company_address}}", address)
        .replace("{{retention_days}}", str(get_int_setting(session, "snapshot_retention_days")))
    )
    return ConsentText(
        version=version,
        language=language,
        text=filled,
        text_sha256=hashlib.sha256(filled.encode("utf-8")).hexdigest(),
    )
