"""Sealed face vectors, the face key command and the face settings (spec M3 AC-6, AC-30, AC-31)."""

import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.crypto import (
    FACE_VECTOR_SIZE,
    FaceDecryptionError,
    SealedVector,
    decode_key,
    enrolment_shot_binding,
    generate_key_text,
    open_vector,
    pending_match_binding,
    seal_vector,
    template_binding,
)
from app.modules.auth.permissions import Role
from app.modules.settings.definitions import DEFINITIONS_BY_KEY
from app.scripts import make_face_key
from tests.people_helpers import log_in, make_user

SETTINGS = "/api/v1/settings"
KEY = decode_key(generate_key_text())
OTHER_KEY = decode_key(generate_key_text())
EMPLOYEE = uuid.uuid4()
MODEL = "buffalo_s/w600k_mbf"


def _vector() -> np.ndarray:
    vector = np.random.default_rng(5).standard_normal(FACE_VECTOR_SIZE).astype(np.float32)
    return vector / np.linalg.norm(vector)


# --- Sealed vectors ---------------------------------------------------------------------------


def test_a_template_opens_with_the_right_key_employee_and_model() -> None:
    sealed = seal_vector(_vector(), template_binding(EMPLOYEE, MODEL), KEY)

    opened = open_vector(sealed, template_binding(EMPLOYEE, MODEL), KEY)

    assert np.array_equal(opened, _vector())
    assert opened.dtype == np.float32


def test_a_sealed_vector_is_not_the_vector_and_each_seal_is_different() -> None:
    binding = template_binding(EMPLOYEE, MODEL)
    first = seal_vector(_vector(), binding, KEY)
    second = seal_vector(_vector(), binding, KEY)

    assert _vector().tobytes() not in first.ciphertext
    assert first.nonce != second.nonce and first.ciphertext != second.ciphertext
    assert len(first.nonce) == 12


@pytest.mark.parametrize(
    "wrong_binding",
    [
        template_binding(uuid.uuid4(), MODEL),  # another employee
        template_binding(EMPLOYEE, "buffalo_l/w600k_r50"),  # read as another model's template
        template_binding(EMPLOYEE, MODEL, key_id="B"),  # another key id
        enrolment_shot_binding(EMPLOYEE, "straight"),  # a template is not a shot
        pending_match_binding(EMPLOYEE, EMPLOYEE),  # nor a pending match
    ],
)
def test_a_template_does_not_open_for_anything_else(wrong_binding: bytes) -> None:
    sealed = seal_vector(_vector(), template_binding(EMPLOYEE, MODEL), KEY)

    with pytest.raises(FaceDecryptionError):
        open_vector(sealed, wrong_binding, KEY)


def test_a_vector_does_not_open_with_another_key() -> None:
    binding = template_binding(EMPLOYEE, MODEL)

    with pytest.raises(FaceDecryptionError):
        open_vector(seal_vector(_vector(), binding, KEY), binding, OTHER_KEY)


def test_a_damaged_or_cut_ciphertext_does_not_open() -> None:
    binding = template_binding(EMPLOYEE, MODEL)
    sealed = seal_vector(_vector(), binding, KEY)
    flipped = bytes([sealed.ciphertext[0] ^ 1]) + sealed.ciphertext[1:]

    with pytest.raises(FaceDecryptionError):
        open_vector(SealedVector(sealed.nonce, flipped), binding, KEY)
    with pytest.raises(FaceDecryptionError):
        open_vector(SealedVector(sealed.nonce, sealed.ciphertext[:-3]), binding, KEY)
    with pytest.raises(FaceDecryptionError):
        open_vector(SealedVector(b"short", sealed.ciphertext), binding, KEY)


def test_only_vectors_of_512_numbers_can_be_sealed() -> None:
    with pytest.raises(ValueError):
        seal_vector(np.zeros(100, dtype=np.float32), b"x", KEY)


def test_shot_and_pending_bindings_depend_on_every_part() -> None:
    session_id, kiosk_id = uuid.uuid4(), uuid.uuid4()

    assert enrolment_shot_binding(session_id, "left") != enrolment_shot_binding(session_id, "right")
    assert pending_match_binding(session_id, kiosk_id) != pending_match_binding(
        kiosk_id, session_id
    )


# --- The key command (AC-31) -----------------------------------------------------------------


def test_make_face_key_prints_one_valid_env_line(capsys: pytest.CaptureFixture[str]) -> None:
    assert make_face_key.main() == 0

    output = capsys.readouterr().out
    name, _, key_text = output.splitlines()[0].partition("=")
    assert name == "FACE_TEMPLATE_KEY"
    assert len(decode_key(key_text)) == 32
    assert "enrolled again" in output  # the warning about losing the key


# --- Face settings (AC-30) -------------------------------------------------------------------


def _settings(client: TestClient) -> dict[str, dict]:
    return {item["key"]: item for item in client.get(SETTINGS).json()["settings"]}


def _change(client: TestClient, **values: object):
    return client.put(SETTINGS, json={"values": values, "reason": "test"})


@pytest.fixture
def boss(db_client: TestClient, db_session: Session) -> TestClient:
    make_user(db_session, Role.SUPER_ADMIN, username="boss")
    log_in(db_client, "boss")
    return db_client


def test_every_face_setting_is_editable_and_has_a_default(boss: TestClient) -> None:
    listed = _settings(boss)
    face_keys = [key for key, d in DEFINITIONS_BY_KEY.items() if d.group in ("face", "privacy")]

    assert len(face_keys) == 20
    for key in face_keys:
        assert listed[key]["editable"] is True, key
    assert listed["face_match_threshold"]["value"] == 0.45
    assert listed["face_challenge_steps"]["value"] == 1
    assert listed["face_code_max_tries"]["value"] == 2
    assert listed["privacy_contact"]["value"] == ""


@pytest.mark.parametrize(
    ("key", "low", "high"),
    [
        ("face_match_threshold", 0.20, 0.90),
        ("face_match_margin", 0.0, 0.30),
        ("face_code_match_threshold", 0.20, 0.90),
        ("face_duplicate_threshold", 0.20, 0.90),
        ("face_consistency_threshold", 0.10, 0.90),
        ("face_antispoof_threshold", 0.10, 0.99),
        ("face_min_yaw_degrees", 10, 40),
        ("face_frontal_max_yaw_degrees", 5, 25),
        ("face_challenge_steps", 1, 2),
        ("face_min_face_px", 40, 200),
        ("face_blur_min", 5, 300),
        ("face_brightness_min", 20, 120),
        ("face_challenge_seconds", 5, 30),
        ("face_code_entry_seconds", 30, 180),
        ("face_code_max_tries", 1, 3),
        ("face_reenrol_code_count", 1, 20),
        ("face_reenrol_score_margin", 0.0, 0.20),
    ],
)
def test_face_settings_accept_their_limits_and_refuse_beyond(
    boss: TestClient, key: str, low: float, high: float
) -> None:
    step = 1 if DEFINITIONS_BY_KEY[key].is_whole_number else 0.01
    # The code floor (0.30) must stay below the match threshold, so lower the floor first.
    assert _change(boss, face_code_offer_floor=0.10).status_code == 200
    assert _change(boss, **{key: low}).status_code == 200
    assert _change(boss, **{key: high}).status_code == 200
    for outside in (low - step, high + step):
        refused = _change(boss, **{key: outside})
        assert refused.status_code == 422
        assert refused.json()["error"]["code"] == "SETTING_OUT_OF_RANGE"


def test_the_next_read_returns_the_changed_threshold(boss: TestClient, db_session: Session) -> None:
    from app.modules.settings.service import get_float_setting

    assert _change(boss, face_match_threshold=0.55).status_code == 200

    assert get_float_setting(db_session, "face_match_threshold") == 0.55


def test_the_code_floor_cannot_be_above_the_match_threshold(boss: TestClient) -> None:
    above = _change(boss, face_code_offer_floor=0.60)  # threshold is 0.45
    assert above.status_code == 422
    assert above.json()["error"]["code"] == "SETTING_INVALID"
    assert "lower than the match threshold" in above.json()["error"]["message"]

    lowered_threshold = _change(boss, face_match_threshold=0.25)  # floor is 0.30
    assert lowered_threshold.json()["error"]["code"] == "SETTING_INVALID"

    both = _change(boss, face_match_threshold=0.70, face_code_offer_floor=0.60)
    assert both.status_code == 200
    assert _settings(boss)["face_code_offer_floor"]["value"] == 0.60


def test_text_settings_are_trimmed_and_length_checked(boss: TestClient) -> None:
    saved = _change(boss, company_address="  Plot 1, MIDC Waluj, Chhatrapati Sambhajinagar  ")
    assert saved.status_code == 200
    assert _settings(boss)["company_address"]["value"] == (
        "Plot 1, MIDC Waluj, Chhatrapati Sambhajinagar"
    )

    for bad in ("abc", "x" * 301, 12345):
        refused = _change(boss, company_address=bad)
        assert refused.json()["error"]["code"] == "SETTING_OUT_OF_RANGE", bad
    assert (
        _change(boss, privacy_contact="Tushar Gawande, tushar@example.invalid").status_code == 200
    )


def test_only_the_super_admin_changes_face_settings(
    db_client: TestClient, db_session: Session
) -> None:
    make_user(db_session, Role.PLANT_HEAD, username="plant.head")
    log_in(db_client, "plant.head")

    refused = _change(db_client, face_match_threshold=0.5)

    assert refused.status_code == 403
    assert _settings(db_client)["face_match_threshold"]["editable"] is True  # visible read-only
