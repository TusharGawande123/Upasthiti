"""Locust load test of the FACE punch (M3, spec AC-1 re-checked through the real endpoint):

    cd backend
    uv run --group loadtest locust -f loadtest/locustfile_face.py --headless -u 1 -r 1 -t 5m \
        --host http://localhost:8001 --csv loadtest/.data/face

One simulated gate asks for a challenge and sends a face punch (3 frames of a public sample face,
signed like a real gate device) every 2 seconds, so the server runs the whole face chain each time:
detect, liveness, anti-spoof, embed and the 1:N match. AC-1 asks for a server decision under 2 s
(95th percentile) on Render Free's 0.1 CPU: run the container with `--cpus=0.1 --memory=512m`.

The data comes from the memory check (app/scripts/face_memory_check.py): run its `prepare` step
against a throw-away `*_memcheck` database and point LOADTEST_FACE_FIXTURE at the fixture file
(default `loadtest/.data/face-fixture.json`, git-ignored). A punch counts as a FAILURE only when
the answer is not 200: many answers are, correctly, "already punched in" for the same few faces.
"""

import base64
import json
import os
import secrets
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from locust import HttpUser, constant_throughput, task

BACKEND_FOLDER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_FOLDER))
# What a gate signs and the punch body are shared with the memory check (never copied here).
from app.modules.kiosks.crypto import signed_message  # noqa: E402
from app.scripts.face_memory_check import CHALLENGE_PATH, PUNCH_PATH, punch_body  # noqa: E402

FIXTURE = Path(
    os.environ.get(
        "LOADTEST_FACE_FIXTURE", BACKEND_FOLDER / "loadtest" / ".data" / "face-fixture.json"
    )
)
PUNCHES_PER_SECOND = float(os.environ.get("LOADTEST_FACE_RATE", "0.5"))

if not FIXTURE.exists():
    raise SystemExit(f"No face fixture at {FIXTURE}. Run face_memory_check prepare first.")
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


class FaceGateUser(HttpUser):
    """One gate device that only takes face punches."""

    wait_time = constant_throughput(PUNCHES_PER_SECOND)

    def on_start(self) -> None:
        key = serialization.load_pem_private_key(DATA["private_key_pem"].encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise SystemExit("The fixture key is not a P-256 key.")
        self.private_key = key
        self.counter = 0  # the server wants a bigger number with every request
        self.sent = 0

    def _post(self, path: str, payload: dict, name: str):
        body = json.dumps(payload).encode()
        self.counter += 1
        nonce = secrets.token_urlsafe(16)
        der = self.private_key.sign(
            signed_message("POST", path, body, nonce, self.counter), ec.ECDSA(hashes.SHA256())
        )
        r, s = decode_dss_signature(der)
        signature = base64.urlsafe_b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
        headers = {
            "X-Kiosk-Id": DATA["kiosk_id"],
            "X-Kiosk-Nonce": nonce,
            "X-Kiosk-Counter": str(self.counter),
            "X-Kiosk-Signature": signature.rstrip(b"=").decode(),
            "Content-Type": "application/json",
            "Origin": self.host,
        }
        return self.client.post(path, data=body, headers=headers, name=name)

    @task
    def face_punch(self) -> None:
        challenge = self._post(CHALLENGE_PATH, {"app_version": "loadtest"}, "POST /punch/challenge")
        if challenge.status_code != 200:
            return
        face = DATA["faces"][self.sent % len(DATA["faces"])]
        self.sent += 1
        self._post(PUNCH_PATH, punch_body(face, challenge.json()), "POST /punch/kiosk (face)")
