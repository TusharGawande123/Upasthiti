"""Cryptography helpers for QR cards (Ed25519 signatures) and snapshots (AES-256-GCM).

These functions are pure: they take the key as an argument and never read settings, so they are
easy to test. Keys are 32 random bytes written as base64url text (the form kept in the
environment variables QR_SIGNING_KEY and SNAPSHOT_ENCRYPTION_KEY).
"""

import base64
import binascii
import os
import secrets
import uuid

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_LENGTH_BYTES = 32
NONCE_LENGTH_BYTES = 12
# The first byte of every encrypted snapshot names the key that made it, so a later key change
# can still read old files (spec §7 rule 17). Only one key exists today.
SNAPSHOT_KEY_ID = b"A"


class SnapshotDecryptionError(Exception):
    """The stored snapshot cannot be read: wrong key, damaged file, or another punch's file."""


# --- Keys ---------------------------------------------------------------------------------


def generate_key_text() -> str:
    """A new random 32-byte key as base64url text, for the make_*_key commands."""
    return base64.urlsafe_b64encode(secrets.token_bytes(KEY_LENGTH_BYTES)).decode().rstrip("=")


def decode_key(key_text: str) -> bytes:
    """Turn key text into 32 bytes. Raises ValueError (without echoing the text) if it is bad."""
    padded = key_text.strip() + "=" * (-len(key_text.strip()) % 4)
    try:
        key = base64.urlsafe_b64decode(padded.encode("ascii"))
    except binascii.Error, UnicodeEncodeError:
        raise ValueError("the key is not valid base64url text") from None
    if len(key) != KEY_LENGTH_BYTES:
        raise ValueError(f"the key must be exactly {KEY_LENGTH_BYTES} bytes")
    return key


# --- Ed25519 signatures for QR cards ------------------------------------------------------


def sign_text(seed: bytes, text: str) -> bytes:
    """Sign ASCII text with the Ed25519 key made from the 32-byte seed (64-byte signature).

    Ed25519 signatures are deterministic: the same text always gives the same signature, so a
    card can be re-printed later without storing its payload.
    """
    return Ed25519PrivateKey.from_private_bytes(seed).sign(text.encode("ascii"))


def public_key_from_seed(seed: bytes) -> Ed25519PublicKey:
    return Ed25519PrivateKey.from_private_bytes(seed).public_key()


def verify_text(public_key: Ed25519PublicKey, text: str, signature: bytes) -> bool:
    """True only if the signature belongs to exactly this text."""
    try:
        public_key.verify(signature, text.encode("ascii"))
    except InvalidSignature, UnicodeEncodeError:
        return False
    return True


def encode_base32(data: bytes) -> str:
    """Upper-case base32 without padding: only A-Z and 2-7, so a QR code can use its compact
    alphanumeric mode."""
    return base64.b32encode(data).decode("ascii").rstrip("=")


def decode_base32(text: str) -> bytes | None:
    """The bytes of upper-case, unpadded base32 text, or None if the text is not valid."""
    padded = text + "=" * (-len(text) % 8)
    try:
        return base64.b32decode(padded.encode("ascii"), casefold=False)
    except binascii.Error, UnicodeEncodeError:
        return None


# --- AES-256-GCM for snapshots ------------------------------------------------------------


def _punch_binding(punch_id: uuid.UUID) -> bytes:
    # The punch ID is "additional authenticated data": the file only opens for this punch, so
    # a stored photo cannot be moved onto another person's punch.
    return str(punch_id).encode("ascii")


def encrypt_snapshot(jpeg_bytes: bytes, punch_id: uuid.UUID, key: bytes) -> bytes:
    """Layout of the result: key id (1 byte) + random nonce (12 bytes) + ciphertext and tag."""
    nonce = os.urandom(NONCE_LENGTH_BYTES)
    sealed = AESGCM(key).encrypt(nonce, jpeg_bytes, _punch_binding(punch_id))
    return SNAPSHOT_KEY_ID + nonce + sealed


def decrypt_snapshot(stored_bytes: bytes, punch_id: uuid.UUID, key: bytes) -> bytes:
    """Give back the JPEG, or raise SnapshotDecryptionError."""
    header_length = len(SNAPSHOT_KEY_ID) + NONCE_LENGTH_BYTES
    if len(stored_bytes) <= header_length or stored_bytes[:1] != SNAPSHOT_KEY_ID:
        raise SnapshotDecryptionError("unknown file format")
    nonce = stored_bytes[1:header_length]
    try:
        return AESGCM(key).decrypt(nonce, stored_bytes[header_length:], _punch_binding(punch_id))
    except InvalidTag:
        raise SnapshotDecryptionError("wrong key or not this punch's file") from None
