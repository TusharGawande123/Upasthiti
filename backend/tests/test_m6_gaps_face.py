"""M6 gap tests for M3: another model's template (AC-21), the gallery cache (AC-22) and the frame
size limits (AC-27) of the face punch."""

import base64
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.face.fake_engine import make_fake_frame
from app.modules.face import gallery_cache
from app.modules.face.models import FaceTemplate
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_face_punch_api import face_punch


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def device() -> Device:
    return Device()


@pytest.fixture
def kiosk(db_session: Session, k134: PlantIds, device: Device) -> KioskDevice:
    return make_active_kiosk(db_session, k134, device)


def test_a_template_of_another_model_is_never_compared(
    boss: TestClient,
    db_client: TestClient,
    db_session: Session,
    device: Device,
    kiosk: KioskDevice,
    k134: PlantIds,
) -> None:
    """M3 AC-21: a template of another model id is skipped, so its owner is not recognised."""
    employee_id = new_employee(boss, k134, code="1043")
    assert enrol(boss, employee_id, person=1).status_code == 201
    template = db_session.scalars(select(FaceTemplate)).one()
    template.model_id = "buffalo_l/w600k_r50"
    db_session.commit()

    answer = face_punch(db_client, device, person=1).json()

    assert answer["decision"] != "accepted"
    assert answer["employee"] is None
    assert db_session.scalars(select(Punch).where(Punch.decision == "accepted")).all() == []


def test_enrol_delete_and_switch_to_qr_each_clear_the_plant_gallery(
    boss: TestClient, k134: PlantIds
) -> None:
    """M3 AC-22: enrolling, deleting face data and switching to QR clear the cached gallery."""
    plant = uuid.UUID(k134.id)
    employee_id = new_employee(boss, k134)

    gallery_cache.remember_gallery(plant, "cached")
    assert enrol(boss, employee_id, person=11).status_code == 201
    assert plant not in gallery_cache.cached_plants()

    gallery_cache.remember_gallery(plant, "cached")
    deleted = boss.post(
        f"/api/v1/employees/{employee_id}/face/template/delete", json={"reason": "Bad enrolment"}
    )
    assert deleted.status_code == 200
    assert plant not in gallery_cache.cached_plants()

    other_id = new_employee(boss, k134, code="1044")
    assert enrol(boss, other_id, person=12).status_code == 201
    gallery_cache.remember_gallery(plant, "cached")
    switched = boss.patch(
        f"/api/v1/employees/{other_id}", json={"punch_method": "qr", "reason": "Asked"}
    )
    assert switched.status_code == 200
    assert plant not in gallery_cache.cached_plants()


def _jpeg_over_70_kb() -> bytes:
    # Padding after the picture: the size check runs before the picture is decoded.
    heavy = make_fake_frame(1) + b"\x00" * 66_000
    assert 70_000 < len(heavy) < 75_000  # still inside the 100,000-character field limit
    return heavy


def test_a_frame_over_70_kb_or_1280_by_960_is_frames_invalid(
    db_client: TestClient, device: Device, kiosk: KioskDevice
) -> None:
    """M3 AC-27: FRAMES_INVALID for a frame over 70 KB and for one of 1280 x 960."""
    heavy = base64.b64encode(_jpeg_over_70_kb()).decode()
    wide = base64.b64encode(make_fake_frame(1, width=1280, height=960)).decode()

    for bad_frame in (heavy, wide):
        frames = [
            {"role": "frontal", "jpeg": bad_frame},
            frame(1, yaw=25.0, role="turn"),
            frame(1),
        ]
        answer = face_punch(db_client, device, 1, frames=frames).json()
        assert answer["decision"] == "rejected"
        assert answer["reason_code"] == "FRAMES_INVALID"
