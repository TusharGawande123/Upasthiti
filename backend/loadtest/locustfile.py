"""Locust load test of the kiosk punch endpoint (S-22, NFR-01):

    cd backend
    uv run --group loadtest locust -f loadtest/locustfile.py --headless -u 7 -r 7 -t 10m \
        --host http://localhost:8001 --csv loadtest/.data/result

Seven simulated gate kiosks, each punching 0.5 times a second for 10 minutes: 300 card punches per
gate, 2,100 in all, which is the client's busiest gate rate (NFR-01) at all seven plants at once.
Every punch is signed like a real kiosk signs it, carries a real 320 px JPEG, and is a different
worker, so each one is accepted (the server does the full work: signature, rules, photo check,
encryption and storage). Every 30 punches the kiosk also sends its 60-second heartbeat.

Prepare the data first with `loadtest/prepare_data.py`. A punch counts as a FAILURE when the answer
is not 200 or the decision is not "accepted", so the failure rate in the report is the real one.
"""

import base64
import io
import itertools
import json
import os
import secrets
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from locust import HttpUser, constant_throughput, task
from locust.exception import StopUser
from PIL import Image

BACKEND_FOLDER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_FOLDER))
# The ONE definition of what a kiosk signs, shared with the server (never copied here).
from app.modules.kiosks.crypto import signed_message  # noqa: E402

FIXTURE = Path(
    os.environ.get("LOADTEST_FIXTURE", BACKEND_FOLDER / "loadtest" / ".data" / "fixture.json")
)
PUNCH_PATH = "/api/v1/punch/kiosk"
ME_PATH = "/api/v1/kiosk/me"
# Per kiosk: 0.5 is the design maximum (300 in 10 minutes). LOADTEST_RATE lowers it, for example
# 0.16 at each of the 7 gates is about 1.1 punches a second in all: all 650 people in 10 minutes.
PUNCHES_PER_SECOND = float(os.environ.get("LOADTEST_RATE", "0.5"))
HEARTBEAT_EVERY_PUNCHES = 30  # 60 seconds at 0.5 punches a second


def make_snapshot_text() -> str:
    """A 320 x 240 JPEG like the kiosk's (about 13 KB), made once: smooth colour plus noise."""
    picture = Image.effect_noise((320, 240), 25).convert("RGB")
    gradient = Image.linear_gradient("L").resize((320, 240)).convert("RGB")
    blended = Image.blend(picture, gradient, 0.6)
    buffer = io.BytesIO()
    blended.save(buffer, format="JPEG", quality=70)
    return base64.b64encode(buffer.getvalue()).decode()


SNAPSHOT = make_snapshot_text()
if not FIXTURE.exists():
    raise SystemExit(f"No kiosk data at {FIXTURE}. Run loadtest/prepare_data.py first.")
KIOSKS: list[dict] = json.loads(FIXTURE.read_text(encoding="utf-8"))["kiosks"]
NEXT_KIOSK = itertools.count()


class KioskUser(HttpUser):
    """One gate kiosk. Seven users start, and each takes the next kiosk of the fixture."""

    wait_time = constant_throughput(PUNCHES_PER_SECOND)

    def on_start(self) -> None:
        self.kiosk = KIOSKS[next(NEXT_KIOSK) % len(KIOSKS)]
        self.private_key = serialization.load_pem_private_key(
            self.kiosk["private_key_pem"].encode(), password=None
        )
        self.counter = 0  # the server wants a bigger number with every request
        self.cards = iter(self.kiosk["cards"])
        self.sent = 0

    def _headers(self, method: str, path: str, body: bytes) -> dict[str, str]:
        self.counter += 1
        nonce = secrets.token_urlsafe(16)
        der = self.private_key.sign(
            signed_message(method, path, body, nonce, self.counter), ec.ECDSA(hashes.SHA256())
        )
        r, s = decode_dss_signature(der)
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")  # what WebCrypto produces
        return {
            "X-Kiosk-Id": self.kiosk["kiosk_id"],
            "X-Kiosk-Nonce": nonce,
            "X-Kiosk-Counter": str(self.counter),
            "X-Kiosk-Signature": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(),
            "Content-Type": "application/json",
            # Writes must come from our own site (the same check a browser meets).
            "Origin": self.host,
        }

    @task
    def punch(self) -> None:
        card_text = next(self.cards, None)
        if card_text is None:
            raise StopUser  # this gate has made its 300 punches
        body = json.dumps(
            {
                "client_punch_id": str(uuid.uuid4()),
                "method": "qr",
                "qr_payload": card_text,
                "snapshot_jpeg": SNAPSHOT,
                "device_time": datetime.now(UTC).isoformat(),
                "app_version": "loadtest",
            }
        ).encode()
        with self.client.post(
            PUNCH_PATH,
            data=body,
            headers=self._headers("POST", PUNCH_PATH, body),
            name="POST /punch/kiosk",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"HTTP {response.status_code}")
            elif response.json().get("decision") != "accepted":
                response.failure(f"not accepted: {response.json().get('reason_code')}")
            else:
                response.success()
        self.sent += 1
        if self.sent % HEARTBEAT_EVERY_PUNCHES == 0:
            self._heartbeat()

    def _heartbeat(self) -> None:
        self.client.get(
            ME_PATH, headers=self._headers("GET", ME_PATH, b""), name="GET /kiosk/me (heartbeat)"
        )
