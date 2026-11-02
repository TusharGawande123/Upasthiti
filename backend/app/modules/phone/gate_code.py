"""The changing phone code on the gate screen (M4b spec §7 rule 15).

A temporary worker punches by scanning this code with their phone. The SERVER signs it, never the
gate device: the device key cannot be copied off the gate, so only that device can ask for codes,
and a secret kept on the device could be copied by anyone with access to the gate PC.

Text: `UPG1.<device id>.<issued at>.<mac>`: capital letters, digits and dots only (QR alphanumeric
mode, a small symbol that is easy to scan). The device id is the 16 bytes of its UUID and the MAC
the first 16 bytes of an HMAC-SHA256, both written in base32 (26 letters each). The text holds no
plant and no name. The key is derived from APP_SECRET_KEY, so there is no new environment variable.

A code is valid from `issued at` for `phone_gate_code_seconds` plus a fixed grace, judged on the
server's receive time. Many workers may scan one code (a queue at shift change); one worker cannot
use it twice, because life + grace is always shorter than the punch cool-down (a setting check).
"""

import base64
import hashlib
import hmac
import io
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import segno

from app.core.config import get_settings

PREFIX = "UPG1"
KEY_LABEL = b"gate-code-v1"
GRACE_SECONDS = 5  # the phone's upload time after the code changed (fixed in code)
MAC_BYTES = 16  # 128 bits
_SHAPE = re.compile(rf"^{PREFIX}\.([A-Z2-7]{{26}})\.([0-9]{{10}})\.([A-Z2-7]{{26}})$")


@dataclass(frozen=True)
class ParsedGateCode:
    device_id: uuid.UUID
    issued_at: datetime
    mac: str


@dataclass(frozen=True)
class IssuedGateCode:
    text: str
    svg: str
    issued_at: datetime
    expires_at: datetime
    refresh_in_seconds: int


def _key() -> bytes:
    return hmac.new(get_settings().app_secret_key.encode(), KEY_LABEL, hashlib.sha256).digest()


def _to_base32(data: bytes) -> str:
    return base64.b32encode(data).decode().rstrip("=")


def _from_base32(text: str) -> bytes:
    return base64.b32decode(text + "=" * (-len(text) % 8))


def _mac(device_id: uuid.UUID, issued_unix: int) -> str:
    message = f"{PREFIX}|{device_id}|{issued_unix}".encode()
    return _to_base32(hmac.new(_key(), message, hashlib.sha256).digest()[:MAC_BYTES])


def build_gate_code(device_id: uuid.UUID, issued_at: datetime) -> str:
    issued_unix = int(issued_at.timestamp())
    return (
        f"{PREFIX}.{_to_base32(device_id.bytes)}.{issued_unix:010d}.{_mac(device_id, issued_unix)}"
    )


def parse_gate_code(text: str) -> ParsedGateCode | None:
    """The three parts of a well-formed code, or None. Only the shape is checked here."""
    found = _SHAPE.match(text)
    if found is None:
        return None
    try:
        device_id = uuid.UUID(bytes=_from_base32(found.group(1)))
    except ValueError:
        return None
    issued_at = datetime.fromtimestamp(int(found.group(2)), tz=UTC)
    return ParsedGateCode(device_id, issued_at, found.group(3))


def mac_is_valid(parsed: ParsedGateCode) -> bool:
    expected = _mac(parsed.device_id, int(parsed.issued_at.timestamp()))
    return hmac.compare_digest(parsed.mac, expected)


def is_too_early_or_late(parsed: ParsedGateCode, now: datetime, life_seconds: int) -> bool:
    """Not yet issued (more than the grace ahead) or older than life + grace."""
    age = (now - parsed.issued_at).total_seconds()
    return age < -GRACE_SECONDS or age > life_seconds + GRACE_SECONDS


def issue_gate_code(device_id: uuid.UUID, now: datetime, life_seconds: int) -> IssuedGateCode:
    issued_at = datetime.fromtimestamp(int(now.timestamp()), tz=UTC)
    text = build_gate_code(device_id, issued_at)
    buffer = io.BytesIO()
    segno.make(text, error="m", micro=False).save(
        buffer, kind="svg", scale=6, border=2, xmldecl=False
    )
    return IssuedGateCode(
        text=text,
        svg=buffer.getvalue().decode("utf-8"),
        issued_at=issued_at,
        expires_at=issued_at + timedelta(seconds=life_seconds),
        # A fresh code every `life - 10` s, so a code just scanned still has at least 10 s left.
        refresh_in_seconds=max(5, life_seconds - 10),
    )
