"""The tool that takes away a plant's current geofence (decision 0033): it deletes nothing, keeps
every version and writes one audit line, and it refuses while a device of that plant still works.
Real PostgreSQL, fake data."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskStatus
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Geofence
from app.modules.users.models import Role
from app.scripts.clear_geofence import ClearRefusedError, clear, find_plant_and_fence
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import client_for, create_plant
from tests.test_org_api import square_geofence


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def test_it_clears_the_fence_and_keeps_every_version(boss: TestClient, db_session: Session) -> None:
    real = create_plant(boss, db_session, "K134")
    url = f"/api/v1/plants/{real.id}/geofence"
    boss.put(url, json=square_geofence(100))
    boss.put(url, json=square_geofence(200))

    plant, fence = find_plant_and_fence(db_session, "k134")
    clear(db_session, plant, fence)
    db_session.commit()

    assert current_geofence(db_session, plant.id) is None
    versions = db_session.scalar(
        select(func.count()).select_from(Geofence).where(Geofence.plant_id == plant.id)
    )
    assert versions == 2
    line = db_session.scalar(select(AuditLog).where(AuditLog.action == "geofence.clear"))
    assert line is not None and line.before == {"version": 2, "shape": "polygon"}


def test_a_plant_without_a_fence_is_refused(boss: TestClient, db_session: Session) -> None:
    create_plant(boss, db_session, "K134")
    with pytest.raises(ClearRefusedError, match="no current geofence"):
        find_plant_and_fence(db_session, "K134")


def test_a_plant_with_a_working_device_is_refused_until_it_is_switched_off(
    boss: TestClient, db_session: Session
) -> None:
    real = create_plant(boss, db_session, "K134")
    boss.put(f"/api/v1/plants/{real.id}/geofence", json=square_geofence())
    gate = make_active_kiosk(db_session, real, Device())

    with pytest.raises(ClearRefusedError, match="1 attendance device"):
        find_plant_and_fence(db_session, "K134")

    gate.status = KioskStatus.REVOKED.value
    db_session.commit()
    plant, fence = find_plant_and_fence(db_session, "K134")
    assert plant.code == "K134" and fence.is_current


def test_an_unknown_plant_is_refused(db_session: Session) -> None:
    with pytest.raises(ClearRefusedError, match="no plant"):
        find_plant_and_fence(db_session, "NOPE")
