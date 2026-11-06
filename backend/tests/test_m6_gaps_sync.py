"""M6 gap test for M4 AC-10: a gate offline for an hour syncs 20 card and 10 face punches of
15 people in one go (two sync requests, the server takes at most 20 items each)."""

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist, utc_now
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.models import Punch, PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role
from tests.clock_helpers import PINNED_DAY, frozen_at, ist
from tests.conftest import clear_cached_settings
from tests.face_helpers import enrol, frame, new_employee, set_privacy
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.offline_helpers import OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, photo_text

pytestmark = pytest.mark.time_sensitive


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def test_twenty_card_and_ten_face_punches_of_fifteen_people_sync_in_pairs(
    boss: TestClient, db_client: TestClient, db_session: Session
) -> None:
    """M4 AC-10: IN then OUT per person, anchored time, face by code with a photo, 1 audit row
    per sync request."""
    with frozen_at(ist(PINNED_DAY, 12)):
        plant: PlantIds = create_plant(boss, db_session, "K134")
        device = Device()
        make_active_kiosk(db_session, plant, device)
        gate = OfflineGate(device)
        gate.take_anchor(utc_now() - timedelta(hours=1))  # 11:00 IST

        # (minutes after the anchor, method, evidence); the OUT is 30+ minutes after the IN
        planned: list[tuple[int, str, dict]] = []
        for number in range(10):  # 10 card people, an IN and an OUT each = 20 card punches
            worker = Worker(boss, plant, code=f"T-{number + 1}")
            card = db_session.get(QrCredential, worker.card_id)
            assert card is not None
            card.valid_from = today_ist() - timedelta(days=2)
            db_session.commit()
            evidence = card_evidence(worker.qr_text, photo_text())
            planned.append((2 + number, "qr", evidence))
            planned.append((40 + number, "qr", evidence))

        for number in range(5):  # 5 face people, an IN and an OUT each = 10 face punches
            code = str(2001 + number)
            employee_id = new_employee(boss, plant, code=code)
            assert enrol(boss, employee_id, person=number + 1).status_code == 201
            evidence = {
                "employee_code": code,
                "frames": [
                    frame(number + 1),
                    frame(number + 1, yaw=25.0, role="turn"),
                    frame(number + 1),
                ],
            }
            planned.append((12 + number, "face", evidence))
            planned.append((55 + number, "face", evidence))

        # The gate saves its punches in the order they happened, so the counters follow time.
        items = [
            gate.item(
                method,
                evidence,
                elapsed=timedelta(minutes=minutes),
                challenge="turn_left" if method == "face" else None,
            )
            for minutes, method, evidence in sorted(planned, key=lambda entry: entry[0])
        ]
        first = gate.send(db_client, items[:20])  # the server takes at most 20 items a request
        second = gate.send(db_client, items[20:])

    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    results = first.json()["results"] + second.json()["results"]
    assert [r["result"] for r in results] == ["saved"] * 30
    assert [r["decision"] for r in results] == ["accepted"] * 30

    punches = list(db_session.scalars(select(Punch).order_by(Punch.punch_time, Punch.id)))
    assert len(punches) == 30
    assert [(p.method, p.was_offline, p.time_proof) for p in punches] == [
        (p.method, True, "anchored") for p in punches
    ]
    assert punches[0].punch_time == ist(PINNED_DAY, 11, 2)  # anchor 11:00 + 2 minutes, exactly
    by_person: dict[object, list[Punch]] = {}
    for punch in punches:
        by_person.setdefault(punch.employee_id, []).append(punch)
    assert len(by_person) == 15
    for person_punches in by_person.values():
        assert [p.direction for p in person_punches] == ["in", "out"]  # IN then the later OUT
    assert all(p.match_mode == "code" for p in punches if p.method == "face")
    assert sum(1 for p in punches if p.method == "face") == 10
    photos = db_session.scalars(
        select(PunchSnapshot).where(PunchSnapshot.reason == "face_offline")
    ).all()
    assert len(photos) == 10
    sync_rows = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "kiosk.sync").order_by(AuditLog.at, AuditLog.id)
    ).all()
    # The clock is frozen, so both rows share one time: compare the counts without an order.
    assert sorted((row.after or {})["saved"] for row in sync_rows) == [10, 20]
    assert db_session.scalars(select(KioskDevice)).one().status == "active"
