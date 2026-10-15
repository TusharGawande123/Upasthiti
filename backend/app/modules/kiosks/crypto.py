"""Pairing-code hashing and kiosk signature checks (spec §7 rules 5 and 6).

The kiosk makes a P-256 key pair in its browser (WebCrypto, private key not extractable).
Every request it sends is signed with that key; we verify with the stored public key.

What is signed (joined by newlines):
    METHOD, PATH (with query), SHA-256 of the body as hex, nonce, counter
WebCrypto produces ECDSA signatures as raw r‖s (64 bytes); the `cryptography` library wants
DER, so we convert.
"""

import base64
import hashlib
import hmac
import secrets

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.core.config import get_settings

PAIRING_CODE_DIGITS = 6
P256_COORDINATE_BYTES = 32


def generate_pairing_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(PAIRING_CODE_DIGITS))


def hash_pairing_code(code: str) -> str:
    """HMAC keyed with APP_SECRET_KEY: a stolen database cannot be used to guess the code
    offline, because a 6-digit code has only a million possibilities."""
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, code.encode(), hashlib.sha256).hexdigest()


def load_public_key(public_key_spki_base64: str) -> ec.EllipticCurvePublicKey:
    """Parse a base64 SPKI key; raises ValueError unless it is a P-256 key."""
    try:
        key = serialization.load_der_public_key(base64.b64decode(public_key_spki_base64))
    except ValueError, TypeError:
        raise ValueError("not a public key") from None
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("not a P-256 key")
    return key


def signed_message(method: str, path: str, body: bytes, nonce: str, counter: int) -> bytes:
    body_hash = hashlib.sha256(body).hexdigest()
    return "\n".join([method.upper(), path, body_hash, nonce, str(counter)]).encode()


def verify_signature(public_key_spki_base64: str, message: bytes, signature_base64url: str) -> bool:
    try:
        public_key = load_public_key(public_key_spki_base64)
        raw = _decode_base64url(signature_base64url)
        if len(raw) != 2 * P256_COORDINATE_BYTES:
            return False
        r = int.from_bytes(raw[:P256_COORDINATE_BYTES], "big")
        s = int.from_bytes(raw[P256_COORDINATE_BYTES:], "big")
        public_key.verify(encode_dss_signature(r, s), message, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature, ValueError:
        return False
    return True


def _decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
