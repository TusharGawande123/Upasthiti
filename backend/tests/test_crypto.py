"""Tests for card signatures and snapshot encryption (spec AC-3 parts, AC-42)."""

import uuid

import pytest

from app.core.crypto import (
    SnapshotDecryptionError,
    decode_base32,
    decode_key,
    decrypt_snapshot,
    encode_base32,
    encrypt_snapshot,
    generate_key_text,
    public_key_from_seed,
    sign_text,
    verify_text,
)

SEED = bytes(range(32))
OTHER_SEED = bytes(range(1, 33))
FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"fake jpeg body " * 40
PAYLOAD_START = "UPS1.A.C000123"


# --- Keys ---------------------------------------------------------------------------------


def test_a_new_key_decodes_to_32_bytes_and_every_key_is_different() -> None:
    first, second = generate_key_text(), generate_key_text()

    assert len(decode_key(first)) == 32
    assert first != second


def test_a_key_works_with_or_without_padding() -> None:
    key_text = generate_key_text()

    assert decode_key(key_text) == decode_key(key_text + "=")


@pytest.mark.parametrize("bad_key", ["", "short", "not base64 !!!", "A" * 44, "é" * 43])
def test_a_bad_key_is_refused_and_the_message_does_not_echo_it(bad_key: str) -> None:
    with pytest.raises(ValueError) as refused:
        decode_key(bad_key)

    assert bad_key not in str(refused.value) or bad_key == ""


# --- Ed25519 card signatures --------------------------------------------------------------


def test_the_same_text_always_gets_the_same_signature() -> None:
    # Deterministic signatures let the server re-print a card without storing its payload.
    assert sign_text(SEED, PAYLOAD_START) == sign_text(SEED, PAYLOAD_START)


def test_a_signature_is_64_bytes_and_103_base32_characters() -> None:
    signature = sign_text(SEED, PAYLOAD_START)

    assert len(signature) == 64
    assert len(encode_base32(signature)) == 103


def test_a_signature_verifies_for_its_own_text_only() -> None:
    public_key = public_key_from_seed(SEED)
    signature = sign_text(SEED, PAYLOAD_START)

    assert verify_text(public_key, PAYLOAD_START, signature)
    assert not verify_text(public_key, "UPS1.A.C000124", signature)
    assert not verify_text(public_key, PAYLOAD_START.lower(), signature)


def test_changing_any_signature_byte_makes_verification_fail() -> None:
    public_key = public_key_from_seed(SEED)
    signature = bytearray(sign_text(SEED, PAYLOAD_START))

    for position in range(len(signature)):
        broken = bytearray(signature)
        broken[position] ^= 0x01
        assert not verify_text(public_key, PAYLOAD_START, bytes(broken))


def test_a_signature_made_with_another_key_is_refused() -> None:
    signature = sign_text(OTHER_SEED, PAYLOAD_START)

    assert not verify_text(public_key_from_seed(SEED), PAYLOAD_START, signature)


def test_text_that_is_not_ascii_is_refused_not_crashed() -> None:
    assert not verify_text(public_key_from_seed(SEED), "UPS1.A.Cé", b"\x00" * 64)


def test_base32_uses_only_the_qr_friendly_alphabet_and_round_trips() -> None:
    data = sign_text(SEED, PAYLOAD_START)

    text = encode_base32(data)

    assert set(text) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    assert decode_base32(text) == data


@pytest.mark.parametrize("bad_text", ["abc", "AB1", "A=", "é"])
def test_bad_base32_text_gives_none(bad_text: str) -> None:
    assert decode_base32(bad_text) is None


# --- AES-256-GCM snapshots ----------------------------------------------------------------


def test_a_snapshot_round_trips_and_the_stored_bytes_are_not_a_jpeg() -> None:
    punch_id, key = uuid.uuid4(), bytes(range(32))

    stored = encrypt_snapshot(FAKE_JPEG, punch_id, key)

    assert not stored.startswith(b"\xff\xd8")
    assert FAKE_JPEG not in stored
    assert decrypt_snapshot(stored, punch_id, key) == FAKE_JPEG


def test_two_encryptions_of_the_same_photo_differ() -> None:
    punch_id, key = uuid.uuid4(), bytes(range(32))

    assert encrypt_snapshot(FAKE_JPEG, punch_id, key) != encrypt_snapshot(FAKE_JPEG, punch_id, key)


def test_a_snapshot_moved_onto_another_punch_cannot_be_opened() -> None:
    key = bytes(range(32))
    stored = encrypt_snapshot(FAKE_JPEG, uuid.uuid4(), key)

    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(stored, uuid.uuid4(), key)


def test_a_snapshot_cannot_be_opened_with_another_key() -> None:
    punch_id = uuid.uuid4()
    stored = encrypt_snapshot(FAKE_JPEG, punch_id, bytes(range(32)))

    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(stored, punch_id, bytes(range(1, 33)))


def test_a_changed_or_cut_snapshot_file_is_refused() -> None:
    punch_id, key = uuid.uuid4(), bytes(range(32))
    stored = encrypt_snapshot(FAKE_JPEG, punch_id, key)
    changed = bytearray(stored)
    changed[-1] ^= 0x01

    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(bytes(changed), punch_id, key)
    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(stored[:10], punch_id, key)


def test_a_file_with_an_unknown_key_id_is_refused() -> None:
    punch_id, key = uuid.uuid4(), bytes(range(32))
    stored = encrypt_snapshot(FAKE_JPEG, punch_id, key)

    with pytest.raises(SnapshotDecryptionError):
        decrypt_snapshot(b"Z" + stored[1:], punch_id, key)
