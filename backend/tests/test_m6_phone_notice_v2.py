"""phone-notice-v2 in English, Marathi and Hindi (M6 F-99, decision 0038): the fixed text hashes,
the language choice, the language stored with "I agree" and the second acceptance after v1."""

import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.phone.models import PhoneNoticeAcceptance
from app.modules.phone.notice import raw_notice, require_notice_accepted
from tests.phone_api_helpers import PHONE, give_password, sessions_of, sign_in

# ruff: noqa: F401, F811 (the fixtures below are the ones of the M4b proofs tests)
from tests.test_m4b_phone_proofs import (
    NOTICE_V1_SHA256,
    People,
    boss,
    demo1,
    error_code,
    people,
    phone,
    snapshot_folder,
)

pytestmark = pytest.mark.time_sensitive

# The raw text of each language is fixed once v2 is in use; a change must be a new version.
NOTICE_V2_SHA256 = {
    "en": "68bbe8047967cb52e9d32dd857c73ef8cc75b27c9592c9345cbc82b0eb43a2a2",
    "mr": "612df61508e0824203cb1f15e1ba90f491ca89bdbce72c1191a650b5da68dd80",
    "hi": "b440f07a8ba89a85eaaf851c239c1a3ed78b950686cb2efefe8bc8b9906ca77d",
}


@pytest.mark.parametrize("language", ["en", "mr", "hi"])
def test_the_notice_text_v2_is_fixed_per_language(language: str) -> None:
    text = raw_notice("phone-notice-v2", language)
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == NOTICE_V2_SHA256[language]
    assert "kiosk" not in text.lower()
    for placeholder in ("{{company_address}}", "{{privacy_contact}}", "{{retention_days}}"):
        assert placeholder in text


def test_v1_is_still_the_same_text() -> None:
    text = raw_notice("phone-notice-v1", "en")
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() == NOTICE_V1_SHA256


def test_the_english_v2_names_the_exact_gps_and_the_face_template() -> None:
    text = raw_notice("phone-notice-v2", "en")
    assert "exact GPS position of your phone is saved with every punch" in text
    assert "encrypted face template made when you were enrolled" in text


def test_the_notice_in_marathi_is_stored_with_its_own_language_and_hash(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)
    sign_in(phone)

    shown = phone.get(f"{PHONE}/notice", params={"language": "mr"}).json()
    assert shown["language"] == "mr" and shown["version"] == "phone-notice-v2"
    assert "फोनवरील हजेरी" in shown["text"] and "{{" not in shown["text"]
    english = phone.get(f"{PHONE}/notice").json()
    assert english["language"] == "en" and english["text_sha256"] != shown["text_sha256"]

    # The hash of another language's text does not match the language that is claimed.
    wrong = phone.post(
        f"{PHONE}/notice/accept",
        json={
            "version": "phone-notice-v2",
            "language": "mr",
            "text_sha256": english["text_sha256"],
        },
    )
    assert wrong.status_code == 409 and error_code(wrong) == "NOTICE_TEXT_CHANGED"

    accepted = phone.post(
        f"{PHONE}/notice/accept",
        json={"version": "phone-notice-v2", "language": "mr", "text_sha256": shown["text_sha256"]},
    )
    assert accepted.status_code == 201, accepted.text
    row = db_session.scalars(select(PhoneNoticeAcceptance)).one()
    assert row.language == "mr"
    assert row.text_sha256 == hashlib.sha256(shown["text"].encode("utf-8")).hexdigest()


def test_an_unknown_notice_language_is_refused(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)
    sign_in(phone)

    for language in ("fr", "../phone-notice-v1.en", ""):
        refused = phone.get(f"{PHONE}/notice", params={"language": language})
        assert refused.status_code == 422 and error_code(refused) == "VALIDATION_FAILED"
    posted = phone.post(
        f"{PHONE}/notice/accept",
        json={"version": "phone-notice-v2", "language": "fr", "text_sha256": "0" * 64},
    )
    assert posted.status_code == 422 and error_code(posted) == "VALIDATION_FAILED"


def test_everyone_who_accepted_v1_is_asked_again(
    db_session: Session, people: People, phone: TestClient
) -> None:
    give_password(db_session, people.face_id)
    sign_in(phone)
    employee_id = uuid.UUID(people.face_id)
    db_session.add(
        PhoneNoticeAcceptance(
            employee_id=employee_id,
            version="phone-notice-v1",
            language="en",
            text_sha256=NOTICE_V1_SHA256,
            accepted_at=utc_now(),
            session_id=sessions_of(db_session, people.face_id)[0].id,
        )
    )
    db_session.commit()

    assert phone.get(f"{PHONE}/me").json()["notice"] == {
        "required": True,
        "version": "phone-notice-v2",
    }
    with pytest.raises(ApiError) as refused:
        require_notice_accepted(db_session, employee_id)
    assert refused.value.code == "PHONE_NOTICE_REQUIRED"
