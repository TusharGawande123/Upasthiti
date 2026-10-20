"""The text inside a card's QR code: UPS1.<key id>.<card serial>.<signature> (spec §7 rule 2).

Example: UPS1.A.C000123.<103 letters and digits>. The signature is Ed25519 over the text before
it ("UPS1.A.C000123"), written in upper-case base32 without padding. Everything is capital
letters, digits and dots, so the QR code can use its compact alphanumeric mode.

There are no dates and no plant in the text: validity and the employee's plant live only in
the database. That way the Super Admin can extend or end a card without reprinting it.
"""

import re
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.core.config import Settings
from app.core.crypto import (
    decode_base32,
    decode_key,
    encode_base32,
    public_key_from_seed,
    sign_text,
    verify_text,
)
from app.core.errors import ApiError

FORMAT_VERSION = "UPS1"
# The strict shape. Anything else is "not an Upasthiti card" (QR_FORMAT_INVALID at the kiosk).
PAYLOAD_PATTERN = re.compile(
    rf"^{FORMAT_VERSION}\.(?P<key_id>[A-Z])\.(?P<serial>[CT][0-9]{{6,9}})\.(?P<signature>[A-Z2-7]{{103}})$"
)
SIGNATURE_LENGTH_BYTES = 64


@dataclass(frozen=True)
class ParsedPayload:
    key_id: str
    serial: str
    signature: bytes

    @property
    def signed_text(self) -> str:
        return signed_text(self.key_id, self.serial)


def signed_text(key_id: str, serial: str) -> str:
    """The part of the payload that the signature covers."""
    return f"{FORMAT_VERSION}.{key_id}.{serial}"


def signing_seed(settings: Settings) -> bytes:
    """The 32-byte signing key from the environment, or QR_SIGNING_NOT_CONFIGURED."""
    if settings.qr_signing_key is None:
        raise ApiError(
            "QR_SIGNING_NOT_CONFIGURED", "Cards are not set up on the server. Tell the admin.", 503
        )
    return decode_key(settings.qr_signing_key.get_secret_value())


def build_payload(settings: Settings, serial: str) -> str:
    """The full QR text of a card. The same serial always gives the same text."""
    key_id = settings.qr_signing_key_id
    signature = sign_text(signing_seed(settings), signed_text(key_id, serial))
    return f"{signed_text(key_id, serial)}.{encode_base32(signature)}"


def parse_payload(text: str) -> ParsedPayload | None:
    """Check the shape only (not the signature). None means the text is not a card."""
    # fullmatch: a plain "$" would also accept a newline at the end.
    match = PAYLOAD_PATTERN.fullmatch(text)
    if match is None:
        return None
    signature = decode_base32(match.group("signature"))
    if signature is None or len(signature) != SIGNATURE_LENGTH_BYTES:
        return None
    # The last base32 character has spare bits, so a different text could decode to the same
    # signature. A card has exactly one valid text: refuse any other spelling.
    if encode_base32(signature) != match.group("signature"):
        return None
    return ParsedPayload(match.group("key_id"), match.group("serial"), signature)


def public_key_for(settings: Settings, key_id: str) -> Ed25519PublicKey | None:
    """The public key for a key id, or None when this server does not know that key.

    Only one key exists today. A later key change adds the old keys here, so cards printed
    with an old key keep working.
    """
    if key_id != settings.qr_signing_key_id:
        return None
    return public_key_from_seed(signing_seed(settings))


def signature_is_valid(settings: Settings, parsed: ParsedPayload) -> bool:
    public_key = public_key_for(settings, parsed.key_id)
    if public_key is None:
        return False
    return verify_text(public_key, parsed.signed_text, parsed.signature)
