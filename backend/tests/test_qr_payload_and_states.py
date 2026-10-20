"""Card payload, card states and date rules (spec §7 rules 2 and 3; AC-3). No database."""

from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.crypto import generate_key_text
from app.core.errors import ApiError
from app.modules.qr_cards.models import QrCredential
from app.modules.qr_cards.payload import (
    PAYLOAD_PATTERN,
    build_payload,
    parse_payload,
    signature_is_valid,
)
from app.modules.qr_cards.service import add_months, check_validity_dates
from app.modules.qr_cards.states import CardState, card_state, works_today

SERIAL = "C000123"
BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


# --- Payload ----------------------------------------------------------------------------------


def test_the_same_serial_always_gives_the_same_payload() -> None:
    settings = get_settings()

    assert build_payload(settings, SERIAL) == build_payload(settings, SERIAL)


def test_the_payload_has_the_agreed_shape_and_length() -> None:
    payload = build_payload(get_settings(), SERIAL)

    assert PAYLOAD_PATTERN.match(payload)
    assert payload.startswith("UPS1.A.C000123.")
    assert len(payload) == 118  # about 118 characters keeps the QR code at version 7 (spec)


def test_a_built_payload_parses_and_verifies() -> None:
    settings = get_settings()

    parsed = parse_payload(build_payload(settings, SERIAL))

    assert parsed is not None
    assert (parsed.key_id, parsed.serial) == ("A", SERIAL)
    assert signature_is_valid(settings, parsed)


def test_changing_any_character_of_the_signature_breaks_it() -> None:
    settings = get_settings()
    payload = build_payload(settings, SERIAL)
    signature_start = len("UPS1.A.C000123.")

    for position in range(signature_start, len(payload)):
        original = payload[position]
        replacement = next(letter for letter in BASE32_ALPHABET if letter != original)
        changed = payload[:position] + replacement + payload[position + 1 :]
        parsed = parse_payload(changed)
        assert parsed is None or not signature_is_valid(settings, parsed)


def test_a_signature_copied_onto_another_serial_is_refused() -> None:
    settings = get_settings()
    payload = build_payload(settings, SERIAL)

    parsed = parse_payload(payload.replace("C000123", "C000124"))

    assert parsed is not None
    assert not signature_is_valid(settings, parsed)


def test_a_signature_made_with_another_key_is_refused() -> None:
    settings = get_settings()
    other = settings.model_copy(update={"qr_signing_key": SecretStr(generate_key_text())})

    parsed = parse_payload(build_payload(other, SERIAL))

    assert parsed is not None
    assert not signature_is_valid(settings, parsed)


def test_a_key_id_this_server_does_not_know_is_refused() -> None:
    settings = get_settings()
    other_id = settings.model_copy(update={"qr_signing_key_id": "B"})

    parsed = parse_payload(build_payload(other_id, SERIAL))

    assert parsed is not None
    assert parsed.key_id == "B"
    assert not signature_is_valid(settings, parsed)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "https://upi.example/pay?id=1",
        "UPS1.A.C000123",  # no signature
        "ups1.a.c000123." + "A" * 103,  # lower case
        "UPS2.A.C000123." + "A" * 103,  # another format version
        "UPS1.A.C00012.AAAA",  # serial too short
        "UPS1.A.X000123." + "A" * 103,  # serial must start with C or T
        "UPS1.A.C000123." + "A" * 102,  # signature too short
        "UPS1.A.C000123." + "1" * 103,  # 1 is not in the base32 alphabet
        "UPS1.A.C000123." + "A" * 103 + "\n",
    ],
)
def test_text_that_is_not_a_card_does_not_parse(text: str) -> None:
    assert parse_payload(text) is None


def test_without_a_signing_key_building_a_payload_says_so() -> None:
    settings = get_settings().model_copy(update={"qr_signing_key": None})

    with pytest.raises(ApiError) as refused:
        build_payload(settings, SERIAL)

    assert refused.value.code == "QR_SIGNING_NOT_CONFIGURED"


# --- States -----------------------------------------------------------------------------------

TODAY = date(2026, 10, 20)


def make_card(valid_from: date, valid_until: date, *, revoked: bool = False) -> QrCredential:
    card = QrCredential(valid_from=valid_from, valid_until=valid_until)
    if revoked:
        card.revoked_at = datetime(2026, 10, 1, tzinfo=timezone.utc)  # noqa: UP017
    return card


@pytest.mark.parametrize(
    ("valid_from", "valid_until", "revoked", "expected"),
    [
        # revoked beats everything
        (TODAY - timedelta(days=30), TODAY + timedelta(days=90), True, CardState.REVOKED),
        (TODAY + timedelta(days=5), TODAY + timedelta(days=90), True, CardState.REVOKED),
        # not yet valid: starts tomorrow
        (TODAY + timedelta(days=1), TODAY + timedelta(days=90), False, CardState.NOT_YET_VALID),
        # starts today: already works
        (TODAY, TODAY + timedelta(days=90), False, CardState.ACTIVE),
        # last day is still valid (counts until 23:59:59 IST of that day)
        (TODAY - timedelta(days=30), TODAY, False, CardState.EXPIRING),
        # the day after is expired
        (TODAY - timedelta(days=30), TODAY - timedelta(days=1), False, CardState.EXPIRED),
        # ending soon: exactly 14 days is "soon", 15 days is not
        (TODAY - timedelta(days=30), TODAY + timedelta(days=14), False, CardState.EXPIRING),
        (TODAY - timedelta(days=30), TODAY + timedelta(days=15), False, CardState.ACTIVE),
    ],
)
def test_card_state_on_the_boundaries(
    valid_from: date, valid_until: date, revoked: bool, expected: CardState
) -> None:
    assert card_state(make_card(valid_from, valid_until, revoked=revoked), TODAY, 14) == expected


def test_only_active_and_ending_soon_cards_work_at_the_kiosk() -> None:
    working = {state for state in CardState if works_today(state)}

    assert working == {CardState.ACTIVE, CardState.EXPIRING}


# --- Dates ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "months", "expected"),
    [
        (date(2026, 11, 1), 6, date(2027, 5, 1)),
        (date(2026, 8, 31), 6, date(2027, 2, 28)),  # the month is shorter: its last day
        (date(2027, 8, 31), 6, date(2028, 2, 29)),  # leap year
        (date(2026, 12, 15), 1, date(2027, 1, 15)),
        (date(2026, 10, 20), 36, date(2029, 10, 20)),
    ],
)
def test_adding_months_keeps_the_day_or_uses_the_months_last_day(
    start: date, months: int, expected: date
) -> None:
    assert add_months(start, months) == expected


def test_valid_dates_are_accepted() -> None:
    check_validity_dates(TODAY, TODAY + timedelta(days=180), TODAY)
    check_validity_dates(TODAY + timedelta(days=60), TODAY + timedelta(days=60), TODAY)
    check_validity_dates(TODAY, add_months(TODAY, 36), TODAY)


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (TODAY - timedelta(days=1), TODAY + timedelta(days=30)),  # starts in the past
        (TODAY + timedelta(days=61), TODAY + timedelta(days=90)),  # starts too far ahead
        (TODAY, TODAY - timedelta(days=1)),  # ends before it starts
        (TODAY, add_months(TODAY, 36) + timedelta(days=1)),  # longer than 3 years
    ],
)
def test_wrong_dates_are_refused(start: date, end: date) -> None:
    with pytest.raises(ApiError) as refused:
        check_validity_dates(start, end, TODAY)

    assert refused.value.code == "QR_VALIDITY_INVALID"
