"""A fake gate device's offline side for tests: it takes a time anchor, makes sealed items and
signs them, and sends them to /kiosk/sync, like the real gate does (M4 spec §5.2, §7 rule 11)."""

import base64
import json
import uuid
from datetime import datetime, timedelta

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.offline_crypto import (
    b64url_encode,
    evidence_binding,
    load_offline_key,
    public_point,
    seal_evidence,
)
from app.modules.kiosks.time_anchor import make_anchor
from app.modules.punches.sync_service import item_statement
from tests.kiosk_helpers import GATE_LOCATION, Device

SYNC = "/api/v1/kiosk/sync"


def server_point() -> bytes:
    """The server's public key, as /kiosk/me hands it to the gate."""
    settings = get_settings()
    assert settings.offline_evidence_key is not None
    return public_point(load_offline_key(settings.offline_evidence_key.get_secret_value()))


class OfflineGate:
    """Wraps a Device that is already paired (kiosk_id set)."""

    def __init__(self, device: Device) -> None:
        self.device = device
        self.anchor_counter = device.counter  # the request counter the anchor came with
        self.anchor_time: datetime | None = None

    def take_anchor(self, server_time: datetime) -> None:
        """Remember a server time, like the gate does from every answer."""
        self.device.counter += 1
        self.anchor_counter = self.device.counter
        self.anchor_time = server_time

    def item(
        self,
        method: str,
        evidence: dict,
        *,
        elapsed: timedelta = timedelta(minutes=30),
        wall_elapsed: timedelta | None = None,
        same_session: bool = True,
        client_punch_id: uuid.UUID | None = None,
        challenge: str | None = None,
        location: dict | None = None,
        anchor_token: str | None = None,
        key_id: str = "A",
        counter: int | None = None,
        binding_punch_id: uuid.UUID | None = None,
        tamper_after_signing: bool = False,
    ) -> dict:
        """One queued punch: signed item text + its signature, as the sync request carries it."""
        assert self.anchor_time is not None, "take_anchor() first"
        punch_id = client_punch_id or uuid.uuid4()
        kiosk_id = uuid.UUID(self.device.kiosk_id)
        anchor = make_anchor(kiosk_id, self.anchor_time, self.anchor_counter)
        self.device.counter += 1
        item_counter = counter if counter is not None else self.device.counter
        sealed = seal_evidence(
            server_point(),
            json.dumps(evidence).encode(),
            evidence_binding(kiosk_id, binding_punch_id or punch_id, method, key_id),
            key_id,
        )
        body = {
            "v": 1,
            "client_punch_id": str(punch_id),
            "method": method,
            "time": {
                "anchor": {
                    "server_time": anchor.server_time.isoformat().replace("+00:00", "Z"),
                    "counter": anchor.counter,
                    "token": anchor_token or anchor.token,
                },
                "elapsed_ms": int(elapsed.total_seconds() * 1000),
                "wall_elapsed_ms": int((wall_elapsed or elapsed).total_seconds() * 1000),
                "same_session": same_session,
                "device_time": None,
            },
            "location": location or GATE_LOCATION,
            "evidence": {
                "key_id": key_id,
                "ephemeral_public_key": b64url_encode(sealed.ephemeral_public_key),
                "nonce": b64url_encode(sealed.nonce),
                "ciphertext": b64url_encode(sealed.ciphertext),
            },
            "app_version": "test",
        }
        if challenge:
            body["challenge"] = challenge
        text = json.dumps(body)
        signature = self._sign(item_statement(kiosk_id, item_counter, text))
        if tamper_after_signing:
            text = text.replace('"app_version": "test"', '"app_version": "evil"')
        return {"counter": item_counter, "signed_item": text, "signature": signature}

    def _sign(self, statement: bytes) -> str:
        der = self.device.private_key.sign(statement, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    def send(self, client: TestClient, items: list[dict], *, counter: int | None = None):
        body = json.dumps({"items": items, "app_version": "test"}).encode()
        headers = self.device.headers("POST", SYNC, body, counter) | {
            "Content-Type": "application/json"
        }
        return client.post(SYNC, content=body, headers=headers)


def card_evidence(qr_text: str, snapshot_base64: str) -> dict:
    return {"qr_payload": qr_text, "snapshot_jpeg": snapshot_base64}
