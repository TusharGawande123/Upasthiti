"""The CI face memory check helper (M3 S-30, spec AC-39) without Docker or real models.

The real run is the CI `docker` job. Here: the gate frame geometry, the signed requests (checked
with the server's own signature check), the punch body, the refusals of `prepare` and the summary
of `punch`.
"""

import base64
import io
import json
from pathlib import Path

import numpy as np
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.face.detector import DetectedFace
from app.face.fake_engine import make_fake_frame
from app.modules.kiosks.crypto import signed_message, verify_signature
from app.scripts import face_memory_check
from app.scripts.face_memory_check import (
    GATE_HEIGHT,
    GATE_WIDTH,
    SignedGate,
    face_for,
    frame_of,
    punch_body,
    to_jpeg,
)

FACES = [{"frontal": "F", "turn_left": "L", "turn_right": "R"}]


def a_face(x1: float, y1: float, size: float) -> DetectedFace:
    return DetectedFace(
        box=(x1, y1, x1 + size, y1 + size), score=0.9, keypoints=np.zeros((5, 2), np.float32)
    )


def test_a_gate_frame_puts_the_face_in_the_middle_at_about_200_px():
    sample = np.zeros((800, 1200, 3), np.uint8)
    sample[300:400, 500:600] = 255  # a white "face" of 100 px

    frame = frame_of(sample, a_face(500, 300, 100), shear=0.0)

    assert frame.shape == (GATE_HEIGHT, GATE_WIDTH, 3)
    white = np.argwhere(frame[:, :, 0] > 128)
    assert abs(white[:, 1].mean() - GATE_WIDTH / 2) < 3
    assert abs(white[:, 0].mean() - GATE_HEIGHT / 2) < 3
    assert 190 <= white[:, 1].max() - white[:, 1].min() <= 210


def test_a_shear_moves_the_lower_part_of_the_face_sideways():
    sample = np.zeros((800, 1200, 3), np.uint8)
    sample[380:400, 540:560] = 255  # a "nose" below the face centre (350)

    straight = np.argwhere(frame_of(sample, a_face(500, 300, 100), 0.0)[:, :, 0] > 128)
    sheared = np.argwhere(frame_of(sample, a_face(500, 300, 100), 0.3)[:, :, 0] > 128)

    assert sheared[:, 1].mean() > straight[:, 1].mean() + 20  # to the right in the picture


def test_a_frame_is_small_enough_for_the_server():
    rng = np.random.default_rng(1)
    smooth = np.linspace(0, 255, GATE_WIDTH, dtype=np.float32)[None, :, None]
    photo_like = np.clip(smooth + rng.normal(0, 12, (GATE_HEIGHT, GATE_WIDTH, 3)), 0, 255)
    noise = rng.integers(0, 255, (GATE_HEIGHT, GATE_WIDTH, 3), np.uint8)

    assert len(to_jpeg(photo_like.astype(np.uint8))) <= face_memory_check.MAX_FRAME_BYTES
    with pytest.raises(RuntimeError, match="frame size limit"):
        to_jpeg(noise)  # pure noise never compresses: refused, never sent too big


def test_the_punch_body_uses_the_turn_the_server_asked_for():
    body = punch_body(FACES[0], {"challenge": "turn_right", "challenge_nonce": "n-1"})

    assert [frame["jpeg"] for frame in body["frames"]] == ["F", "R", "F"]
    assert [frame["role"] for frame in body["frames"]] == ["frontal", "turn", "frontal"]
    assert body["challenge_nonce"] == "n-1" and body["method"] == "face"


def test_each_challenge_is_answered_by_a_face_with_that_turn():
    faces = [
        {"frontal": "A", "turn_left": None, "turn_right": "AR"},
        {"frontal": "B", "turn_left": "BL", "turn_right": None},
        {"frontal": "C", "turn_left": None, "turn_right": "CR"},
    ]

    assert [face_for(faces, "turn_right", index)["frontal"] for index in range(3)] == [
        "A",
        "C",
        "A",
    ]
    assert face_for(faces, "turn_left", 5)["frontal"] == "B"


def test_requests_are_signed_like_a_gate_device(monkeypatch: pytest.MonkeyPatch):
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    spki = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    sent = []

    class Answer(io.BytesIO):
        status = 200

    def fake_urlopen(request, timeout):
        sent.append(request)
        return Answer(b'{"ok": true}')

    monkeypatch.setattr(face_memory_check.urllib.request, "urlopen", fake_urlopen)
    gate = SignedGate("http://127.0.0.1:10000/", "https://ci.example.invalid", "k-1", pem)

    assert gate.post("/api/v1/punch/challenge", {"app_version": "x"}) == (200, {"ok": True})
    assert gate.post("/api/v1/punch/challenge", {"app_version": "x"})[0] == 200

    request = sent[1]
    headers = {name.lower(): value for name, value in request.header_items()}
    assert request.full_url == "http://127.0.0.1:10000/api/v1/punch/challenge"
    assert headers["x-kiosk-counter"] == "2"  # a bigger number every time
    assert headers["origin"] == "https://ci.example.invalid"
    message = signed_message(
        "POST", "/api/v1/punch/challenge", request.data, headers["x-kiosk-nonce"], 2
    )
    assert verify_signature(base64.b64encode(spki).decode(), message, headers["x-kiosk-signature"])


def test_punch_counts_the_answers_and_fails_on_http_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
):
    fixture = tmp_path / "fixture.json"
    fixture.write_text(json.dumps({"kiosk_id": "k", "private_key_pem": "", "faces": FACES}))
    answers = iter(
        [
            (200, {"challenge": "turn_left", "challenge_nonce": "a"}),
            (200, {"decision": "accepted", "reason_code": None}),
            (200, {"challenge": "turn_right", "challenge_nonce": "b"}),
            (200, {"decision": "rejected", "reason_code": "ALREADY_IN"}),
            (503, {}),
        ]
    )

    class FakeGate:
        def __init__(self, *args) -> None:
            pass

        def post(self, path: str, payload: dict):
            return next(answers)

    monkeypatch.setattr(face_memory_check, "SignedGate", FakeGate)

    code = face_memory_check.main(
        ["punch", "--fixture", str(fixture), "--url", "http://x", "--count", "3"]
    )

    assert code == 1
    line = capsys.readouterr().out.strip()
    summary = json.loads(line.removeprefix("FACE_MEMORY_CHECK "))
    assert summary["answers"] == {"accepted:-": 1, "rejected:ALREADY_IN": 1}
    assert summary["http_errors"] == {"503": 1}


def test_prepare_refuses_any_database_but_a_memcheck_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@127.0.0.1:1/upasthiti")

    code = face_memory_check.main(["prepare", "--fixture", str(tmp_path / "f.json")])

    assert code == 1
    assert "throw-away *_memcheck database" in capsys.readouterr().out
    assert not (tmp_path / "f.json").exists()


def test_frames_of_a_sample_without_faces_are_empty():
    class NoFaces:
        def detect(self, picture):
            return []

    sample = np.frombuffer(make_fake_frame(0), np.uint8)
    limits = face_memory_check.YawLimits(min_yaw=18, frontal_max_yaw=12, min_face_px=80)

    assert face_memory_check.gate_frames_of_sample(NoFaces(), sample, limits) == []  # type: ignore[arg-type]


# --- The phone part (M4b S-49, AC-59) ---------------------------------------------------------


class FakePhoneServer:
    """A tiny local server that answers like the phone endpoints, so `phone` can be run for real
    (real sockets, threads and cookies) without the backend. `sign_in_status` is what every
    password sign-in of the "rush" gets; the punching phones always sign in with 200."""

    def __init__(self, sign_in_status: int = 200, punch_status: int = 200) -> None:
        import http.server
        import threading

        self.seen: list[tuple[str, str, str]] = []  # method, path, cookie
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - quiet
                return

            def _answer(self, status: int, body: dict, cookie: str | None = None) -> None:
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                if cookie:
                    self.send_header("Set-Cookie", cookie)
                self.end_headers()
                self.wfile.write(raw)

            def _read(self) -> dict:
                length = int(self.headers.get("Content-Length", 0))
                return json.loads(self.rfile.read(length)) if length else {}

            def do_GET(self) -> None:  # noqa: N802
                outer.seen.append(("GET", self.path, self.headers.get("Cookie", "")))
                self._answer(200, {"version": "1", "text_sha256": "a" * 64})

            def do_POST(self) -> None:  # noqa: N802
                body = self._read()
                outer.seen.append(("POST", self.path, self.headers.get("Cookie", "")))
                if self.path == "/api/v1/phone/login":
                    punching = body["employee_code"].startswith("MEM0")
                    status = 200 if punching else sign_in_status
                    cookie = f"ups_phone=token-{body['employee_code']}; Secure; HttpOnly"
                    self._answer(status, {}, cookie if status == 200 else None)
                elif self.path == "/api/v1/phone/notice/accept":
                    self._answer(201, {})
                elif self.path == "/api/v1/phone/punch/challenge":
                    self._answer(200, {"challenge": "turn_left", "challenge_nonce": "n"})
                else:
                    self._answer(punch_status, {})

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> FakePhoneServer:
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:  # noqa: ANN002
        self.server.shutdown()
        self.server.server_close()


def write_phone_fixture(path: Path) -> None:
    faces = [
        {
            "employee_code": f"MEM{number:03d}",
            "frontal": "F",
            "turn_left": "L",
            "turn_right": "R",
        }
        for number in (1, 2)
    ]
    path.write_text(
        json.dumps(
            {
                "phone_password": "x",
                "faces": faces,
                "sign_in_codes": [f"MEMP{number:02d}" for number in range(1, 9)],
            }
        )
    )


def test_the_phone_check_signs_in_eight_phones_and_punches_with_four(tmp_path, capsys):
    write_phone_fixture(tmp_path / "f.json")

    with FakePhoneServer() as server:
        code = face_memory_check.phone(tmp_path / "f.json", server.url, "https://x.invalid", 8, 4)

    assert code == 0
    summary = json.loads(capsys.readouterr().out.split("PHONE_MEMORY_CHECK ", 1)[1])
    assert summary["sign_ins"] == {"200": 8}
    assert summary["punches"] == {"200": 4}
    # A punching phone sends its own cookie by hand (the real one is Secure, plain http is used).
    punches = [seen for seen in server.seen if seen[1] == "/api/v1/phone/punch/face"]
    assert len(punches) == 4
    assert all(cookie.startswith("ups_phone=token-MEM0") for _, _, cookie in punches)


def test_the_phone_check_accepts_429_for_a_sign_in_that_waited_too_long(tmp_path, capsys):
    write_phone_fixture(tmp_path / "f.json")

    with FakePhoneServer(sign_in_status=429) as server:
        code = face_memory_check.phone(tmp_path / "f.json", server.url, "https://x.invalid", 8, 4)

    assert code == 0
    assert '"429": 8' in capsys.readouterr().out


def test_the_phone_check_fails_on_a_server_error(tmp_path, capsys):
    write_phone_fixture(tmp_path / "f.json")

    with FakePhoneServer(sign_in_status=500) as server:
        failed_sign_in = face_memory_check.phone(
            tmp_path / "f.json", server.url, "https://x.invalid", 8, 4
        )
    with FakePhoneServer(punch_status=500) as server:
        failed_punch = face_memory_check.phone(
            tmp_path / "f.json", server.url, "https://x.invalid", 8, 4
        )

    assert failed_sign_in == 1
    assert failed_punch == 1
    capsys.readouterr()
