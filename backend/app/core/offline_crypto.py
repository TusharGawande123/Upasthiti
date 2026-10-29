"""Opening the evidence of offline punches (M4 spec §8.2, decision 0025 item 2).

While the internet is down, the gate device keeps each punch's evidence (card text and photo, or
the typed code and face pictures) in a locked form that ONLY this server can open:
  1. the device makes a new P-256 key pair for every punch (WebCrypto, never stored);
  2. ECDH between that key and the server's public key gives a shared secret;
  3. HKDF-SHA256 (salt = the device's one-time public key, info = HKDF_INFO) turns it into an
     AES-256-GCM key;
  4. AES-GCM encrypts the evidence with a random 12-byte nonce, bound to
     "kiosk id | punch id | method | key id", so a ciphertext moved to another punch fails.
The device throws its one-time private key away, so not even the device can open its own queue.
The server's private key is OFFLINE_EVIDENCE_KEY (PKCS#8, base64url); lose it and the punches
still waiting on gate devices can no longer be read.
"""

import base64
import os
import uuid
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

HKDF_INFO = b"upasthiti-offline-evidence-v1"
NONCE_BYTES = 12
POINT_BYTES = 65  # an uncompressed P-256 point: 0x04 + x + y


class EvidenceUnreadableError(Exception):
    """The evidence cannot be opened: wrong key, edited, moved to another punch, or malformed."""


@dataclass(frozen=True)
class SealedEvidence:
    key_id: str
    ephemeral_public_key: bytes  # the device's one-time public key (65 bytes)
    nonce: bytes
    ciphertext: bytes  # with the 16-byte GCM tag at the end, as WebCrypto gives it


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def generate_offline_key_text() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    der = key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return b64url_encode(der)


def load_offline_key(text: str) -> ec.EllipticCurvePrivateKey:
    """Raises ValueError for anything that is not a P-256 private key (the text is never echoed)."""
    try:
        key = serialization.load_der_private_key(b64url_decode(text.strip()), password=None)
    except ValueError, TypeError:
        raise ValueError("not a valid offline evidence key") from None
    if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != "secp256r1":
        raise ValueError("not a P-256 key")
    return key


def public_point(key: ec.EllipticCurvePrivateKey) -> bytes:
    """The public key as the 65-byte point the gate device imports ("raw" in WebCrypto)."""
    return key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def evidence_binding(
    kiosk_id: uuid.UUID, client_punch_id: uuid.UUID, method: str, key_id: str
) -> bytes:
    return f"{kiosk_id}|{client_punch_id}|{method}|{key_id}".encode()


def _aes_key(shared_secret: bytes, ephemeral_point: bytes) -> bytes:
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=ephemeral_point, info=HKDF_INFO)
    return hkdf.derive(shared_secret)


def open_evidence(key: ec.EllipticCurvePrivateKey, sealed: SealedEvidence, binding: bytes) -> bytes:
    if len(sealed.ephemeral_public_key) != POINT_BYTES or len(sealed.nonce) != NONCE_BYTES:
        raise EvidenceUnreadableError
    try:
        their_key = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), sealed.ephemeral_public_key
        )
        shared = key.exchange(ec.ECDH(), their_key)
        aes = AESGCM(_aes_key(shared, sealed.ephemeral_public_key))
        return aes.decrypt(sealed.nonce, sealed.ciphertext, binding)
    except ValueError, InvalidTag:
        raise EvidenceUnreadableError from None


def seal_evidence(
    server_point: bytes,
    plaintext: bytes,
    binding: bytes,
    key_id: str,
    *,
    ephemeral_key: ec.EllipticCurvePrivateKey | None = None,
    nonce: bytes | None = None,
) -> SealedEvidence:
    """What the gate device does (used by tests, the shared test vector and the load test)."""
    one_time = ephemeral_key or ec.generate_private_key(ec.SECP256R1())
    server_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), server_point)
    ephemeral_point = public_point(one_time)
    shared = one_time.exchange(ec.ECDH(), server_key)
    nonce = nonce or os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(_aes_key(shared, ephemeral_point)).encrypt(nonce, plaintext, binding)
    return SealedEvidence(key_id, ephemeral_point, nonce, ciphertext)
