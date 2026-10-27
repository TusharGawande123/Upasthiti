"""Cryptography helpers for QR cards (Ed25519), snapshots and face vectors (AES-256-GCM).

These functions are pure: they take the key as an argument and never read settings, so they are
easy to test. Keys are 32 random bytes written as base64url text (the form kept in the
environment variables QR_SIGNING_KEY, SNAPSHOT_ENCRYPTION_KEY and FACE_TEMPLATE_KEY).
"""

import base64
import binascii
import os
import secrets
import uuid
from dataclasses import dataclass

import numpy as np
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


# --- AES-256-GCM for face vectors (spec M3 §7 rule 10) ------------------------------------

FACE_KEY_ID = "A"  # stored beside every sealed vector, so a later key change stays possible
FACE_VECTOR_SIZE = 512  # numbers in a face template or embedding
FACE_VECTOR_BYTES = FACE_VECTOR_SIZE * 4  # float32


class FaceDecryptionError(Exception):
    """A sealed face vector cannot be opened: wrong key, damaged data, or it belongs elsewhere."""


@dataclass(frozen=True)
class SealedVector:
    """What the database stores: the random nonce and the ciphertext (with the GCM tag)."""

    nonce: bytes
    ciphertext: bytes


# The "binding" (GCM additional authenticated data) ties a sealed vector to the one thing it
# belongs to. A ciphertext copied to another employee, session or pending match, or read as
# another model's template, fails to open.


def template_binding(employee_id: uuid.UUID, model_id: str, key_id: str = FACE_KEY_ID) -> bytes:
    return f"face-template:{employee_id}:{model_id}:{key_id}".encode()


def enrolment_shot_binding(session_id: uuid.UUID, pose: str) -> bytes:
    return f"face-shot:{session_id}:{pose}".encode()


def pending_match_binding(pending_id: uuid.UUID, kiosk_id: uuid.UUID) -> bytes:
    return f"face-pending:{pending_id}:{kiosk_id}".encode()


def seal_vector(vector: np.ndarray, binding: bytes, key: bytes) -> SealedVector:
    """Encrypt a 512-number vector (stored as float32)."""
    as_bytes = np.asarray(vector, dtype="<f4").tobytes()
    if len(as_bytes) != FACE_VECTOR_BYTES:
        raise ValueError(f"a face vector has exactly {FACE_VECTOR_SIZE} numbers")
    nonce = os.urandom(NONCE_LENGTH_BYTES)
    return SealedVector(nonce, AESGCM(key).encrypt(nonce, as_bytes, binding))


def open_vector(sealed: SealedVector, binding: bytes, key: bytes) -> np.ndarray:
    """Give back the vector, or raise FaceDecryptionError."""
    try:
        as_bytes = AESGCM(key).decrypt(sealed.nonce, sealed.ciphertext, binding)
    except InvalidTag, ValueError:
        raise FaceDecryptionError("wrong key or not this record's vector") from None
    if len(as_bytes) != FACE_VECTOR_BYTES:
        raise FaceDecryptionError("unexpected vector size")
    return np.frombuffer(as_bytes, dtype="<f4").astype(np.float32)
