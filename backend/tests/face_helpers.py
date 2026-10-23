"""Helpers for the face tests: privacy settings, consent, a full enrolment and painted frames.

The fake face engine (tests/conftest.py) reads grey marks in the pictures, so "person 3" is the
same face in every picture made with person=3. No real face is ever used.
"""

import base64

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.face.fake_engine import Problem, make_fake_frame
from app.modules.settings.models import SettingValue
from tests.people_helpers import PlantIds, permanent_body

AGREE = {"text_version": "face-consent-v1", "language": "en", "choice": "agreed"}
POSE_FRAMES = {  # enrolment pose -> (yaw, pitch) of the painted picture
    "straight": (0, 0),
    "left": (20, 0),
    "right": (-20, 0),
    "up": (0, 20),
    "down": (0, -20),
    "closer": (0, 0),
    "farther": (0, 0),
    "work_wear": (0, 0),
}


def set_privacy(session: Session) -> None:
    session.merge(SettingValue(key="privacy_contact", value="Tushar Gawande, t@example.invalid"))
    session.merge(SettingValue(key="company_address", value="Plot 1, MIDC Waluj"))
    session.commit()


def new_employee(
    boss: TestClient, plant: PlantIds, code: str = "1043", consent: bool = True
) -> str:
    response = boss.post(
        "/api/v1/employees", json=permanent_body(plant, code=code, name=f"Worker {code}")
    )
    assert response.status_code == 201, response.text
    employee_id = response.json()["id"]
    if consent:
        given = boss.post(f"/api/v1/employees/{employee_id}/face/consent", json=AGREE)
        assert given.status_code == 201, given.text
    return employee_id


def start(boss: TestClient, employee_id: str) -> str:
    response = boss.post(f"/api/v1/employees/{employee_id}/face/enrolment-sessions")
    assert response.status_code == 201, response.text
    return response.json()["session_id"]


def shot(
    boss: TestClient,
    session_id: str,
    pose: str,
    person: int,
    problem: Problem = Problem.NONE,
    yaw: float | None = None,
    pitch: float | None = None,
    width: int = 640,
    height: int = 480,
):
    default_yaw, default_pitch = POSE_FRAMES[pose]
    jpeg = make_fake_frame(
        person,
        yaw_degrees=default_yaw if yaw is None else yaw,
        problem=problem,
        pitch_degrees=default_pitch if pitch is None else pitch,
        width=width,
        height=height,
    )
    return boss.post(
        f"/api/v1/face/enrolment-sessions/{session_id}/shots",
        json={"pose": pose, "image_jpeg": base64.b64encode(jpeg).decode()},
    )


def enrol(boss: TestClient, employee_id: str, person: int, **finish: str):
    session_id = start(boss, employee_id)
    for pose in POSE_FRAMES:
        answer = shot(boss, session_id, pose, person)
        assert answer.json()["accepted"] is True, (pose, answer.json())
    return boss.post(f"/api/v1/face/enrolment-sessions/{session_id}/finish", json=finish)


def frame(person: int, yaw: float = 0.0, problem: Problem = Problem.NONE, role: str = "frontal"):
    jpeg = make_fake_frame(person, yaw_degrees=yaw, problem=problem)
    return {"role": role, "jpeg": base64.b64encode(jpeg).decode()}
