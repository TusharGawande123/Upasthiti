"""A fake gate device for tests: it makes a P-256 key and signs requests like WebCrypto does."""

import base64
import secrets
import uuid

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from sqlalchemy.orm import Session

from app.modules.kiosks.crypto import signed_message
from app.modules.kiosks.models import KioskDevice

# Every test plant with a gate device gets a 200 m circle fence (M4: location on every punch).
from app.scripts.gate_fence_fixture import (  # noqa: E402
    GATE_FENCE_MARGIN_M,
    GATE_FENCE_RADIUS_M,
    GATE_LAT,
    GATE_LOCATION,
    GATE_LON,
    ensure_gate_fence,
)
from tests.people_helpers import PlantIds

__all__ = [
    "GATE_FENCE_MARGIN_M",
    "GATE_FENCE_RADIUS_M",
    "GATE_LAT",
    "GATE_LOCATION",
    "GATE_LON",
    "Device",
    "ensure_gate_fence",
    "make_active_kiosk",
]


class Device:
    """A fake gate device: it makes a P-256 key and signs requests like WebCrypto does."""

    def __init__(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        spki = self.private_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        self.public_key = base64.b64encode(spki).decode()
        self.kiosk_id = ""
        self.counter = 0

    def headers(self, method: str, path: str, body: bytes = b"", counter: int | None = None):
        counter = counter if counter is not None else self.counter + 1
        self.counter = max(self.counter, counter)
        nonce = secrets.token_urlsafe(16)
        der = self.private_key.sign(
            signed_message(method, path, body, nonce, counter), ec.ECDSA(hashes.SHA256())
        )
        r, s = decode_dss_signature(der)
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")  # WebCrypto's format
        return {
            "X-Kiosk-Id": self.kiosk_id,
            "X-Kiosk-Nonce": nonce,
            "X-Kiosk-Counter": str(counter),
            "X-Kiosk-Signature": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(),
        }


def make_active_kiosk(
    session: Session, plant: PlantIds, device: Device, name: str = "Main gate"
) -> KioskDevice:
    """A paired kiosk made straight in the database (pairing itself is tested elsewhere), at a
    plant with a fence around GATE_LOCATION."""
    ensure_gate_fence(session, uuid.UUID(plant.id))
    kiosk = KioskDevice(
        plant_id=uuid.UUID(plant.id), name=name, status="active", public_key=device.public_key
    )
    session.add(kiosk)
    session.commit()
    device.kiosk_id = str(kiosk.id)
    return kiosk
