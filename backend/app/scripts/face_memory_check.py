"""Memory check of the face punch for CI (M3 S-30, spec AC-39): does the backend stay under 450 MB?

The CI `docker` job starts the real backend image with `--memory=512m` (Render Free's limit),
sends face punches through the real endpoints, and then reads the container's peak memory.
This script does the two parts around it, each in its own throw-away container of the same image
(never inside the measured one, so its own memory is not counted):

  prepare  wipes and fills a throw-away database whose name ends in `_memcheck`: one plant, one
           gate device with a fresh P-256 key, one face employee per face of the public InsightFace
           sample picture `t1.jpg` (no employee, no real person of ours), and writes a fixture
           file with the device's key and the gate frames of each face.
  punch    sends `--count` face punches (challenge, then punch), signed like a gate device, prints
           one `FACE_MEMORY_CHECK {json}` line with the answers, and fails on any HTTP error.

A flat picture cannot turn its head, so the "turned" frames are made by a horizontal shear: it
moves the nose sideways against the eyes, which is what the server measures as a head turn. The
sample's faces already look a little to one side, so a face gives a left turn, a right turn or
both; `punch` answers each challenge with a face that has that turn. The anti-spoof setting is
put at its lowest value in this database, so the photo-of-a-photo still reaches the embedder and
the 1:N match: every model runs, as in a real punch. The check fails on memory or HTTP errors
only, never on a decision.

Usage (the CI job shows the full commands):
  python -m app.scripts.face_memory_check prepare --fixture /work/fixture.json
  python -m app.scripts.face_memory_check punch --fixture /work/fixture.json \
      --url http://127.0.0.1:10000 --count 20
"""

import argparse
import base64
import json
import secrets
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import cv2
import numpy as np
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.antiproxy.rules.face_frames import MAX_FRAME_BYTES, MIN_DETECTOR_SCORE
from app.face.detector import DetectedFace
from app.face.images import decode_jpeg
from app.face.models import FaceModels
from app.face.quality import estimate_yaw
from app.modules.kiosks.crypto import signed_message

DATABASE_NAME_ENDING = "_memcheck"
GATE_WIDTH, GATE_HEIGHT = 640, 480
CROP_PER_FACE_WIDTH = 3.2  # the frame is 3.2 face widths wide: a face of about 200 px
# Tried from small to big, both ways: -0.80 .. 0.80 in steps of 0.05.
SHEARS = sorted((round(0.05 * step, 2) for step in range(-16, 17)), key=abs)
YAW_SPARE = 4.0  # degrees beyond the settings' limits, so a rounding never decides
CHALLENGE_PATH = "/api/v1/punch/challenge"
PUNCH_PATH = "/api/v1/punch/kiosk"


# ---------------------------------------------------------------------------- gate frames


@dataclass(frozen=True)
class GateFrames:
    frontal: bytes
    turn_left: bytes | None  # the person's own left (yaw > 0), unmirrored as the gate sends it
    turn_right: bytes | None


def frame_of(sample: np.ndarray, face: DetectedFace, shear: float) -> np.ndarray:
    """A 640 × 480 gate frame around one face, sheared sideways by `shear` (0 = straight).

    One affine warp does it all: move the face centre to the frame centre, scale it to about
    200 px, and add `shear` × (height below the face centre) to x. The eyes sit above the nose,
    so the nose moves sideways against them."""
    x1, y1, x2, y2 = face.box
    centre_x, centre_y = (x1 + x2) / 2, (y1 + y2) / 2
    scale = GATE_WIDTH / (face.width * CROP_PER_FACE_WIDTH)
    matrix = np.array(
        [
            [scale, scale * shear, GATE_WIDTH / 2 - scale * (centre_x + shear * centre_y)],
            [0.0, scale, GATE_HEIGHT / 2 - scale * centre_y],
        ],
        dtype=np.float32,
    )
    return cv2.warpAffine(
        sample, matrix, (GATE_WIDTH, GATE_HEIGHT), borderMode=cv2.BORDER_REPLICATE
    )


def to_jpeg(picture: np.ndarray) -> bytes:
    for quality in (85, 75, 65, 55):
        ok, encoded = cv2.imencode(".jpg", picture, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok and len(encoded) <= MAX_FRAME_BYTES:
            return encoded.tobytes()
    raise RuntimeError("a gate frame does not fit the frame size limit")


def read_yaw(models: FaceModels, jpeg: bytes, min_face_px: int) -> float | None:
    """The head turn the server will read from this frame, or None when the frames rule would
    refuse it (no face, a second big face, or a face too small)."""
    picture = decode_jpeg(
        jpeg, min_width=320, max_width=GATE_WIDTH, min_height=240, max_height=GATE_HEIGHT
    )
    faces = [face for face in models.detect(picture) if face.score >= MIN_DETECTOR_SCORE]
    if not faces or faces[0].width < min_face_px:
        return None
    if any(other.width >= faces[0].width * 0.5 for other in faces[1:]):
        return None
    return estimate_yaw(faces[0].keypoints)


@dataclass(frozen=True)
class YawLimits:
    min_yaw: float
    frontal_max_yaw: float
    min_face_px: int


def frames_of_face(
    models: FaceModels, sample: np.ndarray, face: DetectedFace, limits: YawLimits
) -> GateFrames | None:
    """The straightest frame and the smallest shears read as a left and a right turn.

    The sample's faces already look a little to one side, and a shear changes the reading by up
    to about 30 degrees, so one face often gives only one of the two turns."""
    yaws = {}
    for shear in SHEARS:
        jpeg = to_jpeg(frame_of(sample, face, shear))
        yaws[jpeg] = read_yaw(models, jpeg, limits.min_face_px)
    readable = {jpeg: yaw for jpeg, yaw in yaws.items() if yaw is not None}
    if not readable:
        return None
    frontal = min(readable, key=lambda jpeg: abs(readable[jpeg]))
    if abs(readable[frontal]) > limits.frontal_max_yaw - YAW_SPARE:
        return None
    turn = limits.min_yaw + YAW_SPARE
    # `readable` keeps the order of SHEARS (smallest first), so next() takes the smallest shear.
    left = next((jpeg for jpeg, yaw in readable.items() if yaw >= turn), None)
    right = next((jpeg for jpeg, yaw in readable.items() if yaw <= -turn), None)
    if left is None and right is None:
        return None
    return GateFrames(frontal, left, right)


def gate_frames_of_sample(
    models: FaceModels, sample: np.ndarray, limits: YawLimits
) -> list[tuple[GateFrames, np.ndarray]]:
    """Frames and the template (embedding of the straight frame) of every usable sample face."""
    usable = []
    for face in models.detect(sample):
        frames = frames_of_face(models, sample, face, limits)
        if frames is None:
            continue
        picture = decode_jpeg(
            frames.frontal,
            min_width=320,
            max_width=GATE_WIDTH,
            min_height=240,
            max_height=GATE_HEIGHT,
        )
        main = models.detect(picture)[0]
        usable.append((frames, models.embed(models.align(picture, main))))
    return usable


# ---------------------------------------------------------------------------- prepare


def prepare(fixture_path: Path) -> int:
    from sqlalchemy import make_url, select

    from app.core.config import load_settings_or_exit
    from app.core.crypto import FACE_KEY_ID, seal_vector, template_binding
    from app.core.db import get_session_factory
    from app.core.time import today_ist, utc_now
    from app.face.models import OnnxFaceModels, RuntimeOptions
    from app.modules.audit.service import Actor
    from app.modules.auth.passwords import hash_password
    from app.modules.employees.operations import AuditContext, create_employee
    from app.modules.employees.rules import EmployeeValues
    from app.modules.face.consent_service import record_consent
    from app.modules.face.engine_provider import face_key
    from app.modules.face.models import ConsentChoice, FaceTemplate
    from app.modules.kiosks.models import KioskDevice
    from app.modules.org.models import EmployeeCategory, Plant, Shift
    from app.modules.org.plants_service import add_client_plants
    from app.modules.settings.definitions import DEFINITIONS_BY_KEY
    from app.modules.settings.models import SettingValue
    from app.modules.users.models import Role, User
    from app.scripts.e2e_seed import _create_database_if_missing, _wipe_and_migrate

    settings = load_settings_or_exit()
    database_name = make_url(settings.database_url).database or ""
    if settings.app_env == "production" or not database_name.endswith(DATABASE_NAME_ENDING):
        print("Refused: only for a throw-away *_memcheck database, never in production.")
        return 1
    if settings.face_template_key is None:
        print("Refused: FACE_TEMPLATE_KEY is needed to seal the templates.")
        return 1
    key = face_key()

    models = OnnxFaceModels(
        settings.face_models_dir,
        settings.face_model_pack,
        options=RuntimeOptions(detector_input_size=settings.face_detector_input),
    )
    sample = cv2.imread(str(settings.face_models_dir / "testdata" / "t1.jpg"))
    if sample is None:
        print("The sample picture is missing: run scripts/download_models.py.")
        return 1

    def default(key: str) -> float:
        return float(DEFINITIONS_BY_KEY[key].default)  # type: ignore[arg-type]

    limits = YawLimits(
        min_yaw=default("face_min_yaw_degrees"),
        frontal_max_yaw=default("face_frontal_max_yaw_degrees"),
        min_face_px=int(default("face_min_face_px")),
    )
    faces = gate_frames_of_sample(models, sample, limits)
    if not any(frames.turn_left for frames, _ in faces) or not any(
        frames.turn_right for frames, _ in faces
    ):
        print("The sample picture gives no left or no right turn: the check cannot run.")
        return 1

    _create_database_if_missing(settings.database_url, database_name)
    _wipe_and_migrate(settings.database_url)
    private_key = ec.generate_private_key(ec.SECP256R1())
    with get_session_factory()() as session:
        admin = User(
            name="Memory check",
            username="memcheck.admin",
            password_hash=hash_password(secrets.token_urlsafe(24)),  # never used to log in
            role=Role.SUPER_ADMIN.value,
            must_change_password=False,
        )
        session.add(admin)
        session.flush()
        actor = Actor("user", admin.id)
        add_client_plants(session, actor=actor)
        plant = session.scalars(select(Plant).order_by(Plant.code)).first()
        if plant is None:
            raise RuntimeError("no plant was made")
        shift = session.scalars(select(Shift).where(Shift.plant_id == plant.id)).first()
        staff = session.scalars(
            select(EmployeeCategory).where(
                EmployeeCategory.plant_id == plant.id, EmployeeCategory.name == "Staff"
            )
        ).one()
        if shift is None:
            raise RuntimeError("the plant has no shift")
        for setting_key, value in (
            ("company_address", "Memory check, not a real address"),
            ("privacy_contact", "Memory check, not a real person"),
            # The sample is a photo, so its anti-spoof score is low: at the lowest allowed value
            # the punch still reaches the embedder and the match (this database only).
            ("face_antispoof_threshold", DEFINITIONS_BY_KEY["face_antispoof_threshold"].minimum),
        ):
            session.merge(SettingValue(key=setting_key, value=value))
        spki = private_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        kiosk = KioskDevice(
            plant_id=plant.id,
            name="Memory check gate",
            status="active",
            public_key=base64.b64encode(spki).decode(),
        )
        session.add(kiosk)
        session.commit()

        for number, (_, embedding) in enumerate(faces, start=1):
            employee = create_employee(
                session,
                AuditContext(actor),
                EmployeeValues(
                    employee_code=f"MEM{number:03d}",
                    full_name=f"Memory Check {number}",
                    type="permanent",
                    plant_id=plant.id,
                    category_id=staff.id,
                    department_id=None,
                    shift_id=shift.id,
                    contractor_id=None,
                    punch_method="face",
                    hourly_rate=None,
                    ot_rate_per_hour=Decimal("150.00"),
                    joined_on=today_ist() - timedelta(days=30),
                ),
            )
            consent = record_consent(
                session,
                actor,
                employee,
                text_version="face-consent-v1",
                language="en",
                choice=ConsentChoice.AGREED,
                explained_language=None,
            )
            sealed = seal_vector(embedding, template_binding(employee.id, models.model_id), key)
            session.add(
                FaceTemplate(
                    employee_id=employee.id,
                    consent_id=consent.id,
                    model_id=models.model_id,
                    key_id=FACE_KEY_ID,
                    nonce=sealed.nonce,
                    ciphertext=sealed.ciphertext,
                    shot_count=5,  # stands in for a normal 5-pose enrolment
                    enrolled_by=admin.id,
                    enrolled_at=utc_now(),
                )
            )
            session.commit()
        kiosk_id = str(kiosk.id)

    fixture = {
        "kiosk_id": kiosk_id,
        "private_key_pem": private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        "faces": [
            {
                "frontal": base64.b64encode(frames.frontal).decode(),
                "turn_left": _text_or_none(frames.turn_left),
                "turn_right": _text_or_none(frames.turn_right),
            }
            for frames, _ in faces
        ],
    }
    fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
    print(f"Prepared {len(faces)} face employees and one gate device ({models.model_id}).")
    return 0


def _text_or_none(jpeg: bytes | None) -> str | None:
    return base64.b64encode(jpeg).decode() if jpeg else None


# ---------------------------------------------------------------------------- punch


class SignedGate:
    """Sends requests signed like a paired gate device (the same message the browser signs)."""

    def __init__(self, base_url: str, origin: str, kiosk_id: str, private_key_pem: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.origin = origin
        self.kiosk_id = kiosk_id
        key = serialization.load_pem_private_key(private_key_pem.encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("the fixture key is not a P-256 key")
        self.private_key = key
        self.counter = 0  # the server wants a bigger number with every request

    def post(self, path: str, payload: dict) -> tuple[int, dict]:
        body = json.dumps(payload).encode()
        self.counter += 1
        nonce = secrets.token_urlsafe(16)
        der = self.private_key.sign(
            signed_message("POST", path, body, nonce, self.counter), ec.ECDSA(hashes.SHA256())
        )
        r, s = decode_dss_signature(der)
        signature = base64.urlsafe_b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
        request = urllib.request.Request(  # noqa: S310 - the URL is our own test server
            self.base_url + path,
            data=body,
            method="POST",
            headers={
                "X-Kiosk-Id": self.kiosk_id,
                "X-Kiosk-Nonce": nonce,
                "X-Kiosk-Counter": str(self.counter),
                "X-Kiosk-Signature": signature.rstrip(b"=").decode(),
                "Content-Type": "application/json",
                "Origin": self.origin,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, {}


def punch_body(face: dict[str, str], challenge: dict) -> dict:
    # The fixture's database keeps face_challenge_steps at 1: turn_left or turn_right.
    turn = face[challenge["challenge"]]
    return {
        "client_punch_id": str(uuid.uuid4()),
        "method": "face",
        "challenge_nonce": challenge["challenge_nonce"],
        "frames": [
            {"role": "frontal", "jpeg": face["frontal"]},
            {"role": "turn", "jpeg": turn},
            {"role": "frontal", "jpeg": face["frontal"]},
        ],
        "device_time": datetime.now(UTC).isoformat(),
        "app_version": "memcheck",
    }


def face_for(faces: list[dict], challenge: str, index: int) -> dict:
    """The faces take turns; only those with a frame of the asked turn can answer it."""
    able = [face for face in faces if face.get(challenge)]
    return able[index % len(able)]


def punch(fixture_path: Path, base_url: str, origin: str, count: int) -> int:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    gate = SignedGate(base_url, origin, fixture["kiosk_id"], fixture["private_key_pem"])
    answers: Counter[str] = Counter()
    http_errors: Counter[int] = Counter()
    seconds = []
    for index in range(count):
        status, challenge = gate.post(CHALLENGE_PATH, {"app_version": "memcheck"})
        if status != 200:
            http_errors[status] += 1
            continue
        face = face_for(fixture["faces"], challenge["challenge"], index)
        started = time.perf_counter()
        status, answer = gate.post(PUNCH_PATH, punch_body(face, challenge))
        seconds.append(time.perf_counter() - started)
        if status != 200:
            http_errors[status] += 1
            continue
        answers[f"{answer['decision']}:{answer.get('reason_code') or '-'}"] += 1
    summary = {
        "punches": count,
        "answers": dict(answers),
        "http_errors": {str(code): number for code, number in http_errors.items()},
        "p50_seconds": round(statistics.median(seconds), 2) if seconds else None,
        "max_seconds": round(max(seconds), 2) if seconds else None,
    }
    print("FACE_MEMORY_CHECK " + json.dumps(summary), flush=True)
    return 1 if http_errors else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Face punch memory check (S-30).")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare", help="fill the *_memcheck database")
    prepare_parser.add_argument("--fixture", type=Path, required=True)
    punch_parser = commands.add_parser("punch", help="send signed face punches")
    punch_parser.add_argument("--fixture", type=Path, required=True)
    punch_parser.add_argument("--url", required=True)
    punch_parser.add_argument("--origin", default="https://ci.example.invalid")
    punch_parser.add_argument("--count", type=int, default=20)
    args = parser.parse_args(argv)
    if args.command == "prepare":
        return prepare(args.fixture)
    return punch(args.fixture, args.url, args.origin, args.count)


if __name__ == "__main__":
    sys.exit(main())
