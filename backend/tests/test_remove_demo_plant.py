"""The tool that removes a DEMO plant for good (decision 0013): it deletes the plant's people,
cards, devices, punches and photos, leaves other plants and the audit log alone, refuses a real
plant, and leaves the "never change a punch" protection switched on. Real PostgreSQL, fake data."""

import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.storage import get_storage
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.kiosks.models import KioskDevice, KioskHeartbeat
from app.modules.org.models import Plant
from app.modules.punches.models import Punch, PunchReview, PunchSnapshot
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role, User
from app.scripts.remove_demo_plant import (
    RemovalRefusedError,
    build_plan,
    delete_photo_files,
    remove,
)
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, send, snapshot_folder  # noqa: F401  (a fixture)


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


def punch_once(client: TestClient, session: Session, plant: PlantIds, code: str) -> Worker:
    """A worker with a card who punched IN at a gate of `plant`."""
    worker = Worker(client, plant, code)
    device = Device()
    make_active_kiosk(session, plant, device)
    answer = send(client, device, worker.qr_text)
    assert answer.json()["decision"] == "accepted", answer.text
    return worker


def count(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_it_removes_only_the_demo_plant_and_leaves_the_audit_log(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    demo = create_plant(boss, db_session, "DEMO")
    real = create_plant(boss, db_session, "K134")
    punch_once(boss, db_session, demo, "DEMO-1")
    punch_once(boss, db_session, real, "REAL-1")
    audit_before = count(db_session, AuditLog)
    assert len(list(snapshot_folder.rglob("*.*"))) == 2

    plan = build_plan(db_session, "demo", include_test_cards=False)
    assert plan.counts["employees"] == 1 and plan.counts["punches"] == 1
    assert plan.counts["photos"] == 1 and plan.counts["attendance devices"] == 1
    remove(db_session, plan)
    db_session.commit()

    plants = {p.code for p in db_session.scalars(select(Plant))}
    assert "DEMO" not in plants and "K134" in plants
    assert [e.employee_code for e in db_session.scalars(select(Employee))] == ["REAL-1"]
    assert count(db_session, Punch) == 1 and count(db_session, PunchSnapshot) == 1
    assert count(db_session, QrCredential) == 1 and count(db_session, KioskDevice) == 1
    # Nothing was taken out of the audit log; one line was added that says what happened.
    assert count(db_session, AuditLog) == audit_before + 1
    last = db_session.scalars(select(AuditLog).order_by(AuditLog.at.desc())).first()
    assert last is not None and last.action == "demo_data.removed"
    assert (last.after or {})["employees"] == 1

    # The photo file of the demo punch is deleted by the second step; the other photo stays.
    failed = delete_photo_files(get_storage(), plan.photo_keys)
    assert failed == [] and len(list(snapshot_folder.rglob("*.*"))) == 1


def test_the_punch_protection_is_on_again_afterwards(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    demo = create_plant(boss, db_session, "DEMO2")
    real = create_plant(boss, db_session, "K134")
    punch_once(boss, db_session, demo, "DEMO-1")
    punch_once(boss, db_session, real, "REAL-1")
    remove(db_session, build_plan(db_session, "DEMO2", include_test_cards=False))
    db_session.commit()

    with pytest.raises(DBAPIError):
        db_session.execute(text("UPDATE punches SET direction = 'out'"))
    db_session.rollback()


def test_a_real_plant_or_an_unknown_code_is_refused(boss: TestClient, db_session: Session) -> None:
    create_plant(boss, db_session, "K134")

    with pytest.raises(RemovalRefusedError):
        build_plan(db_session, "K134", include_test_cards=False)
    with pytest.raises(RemovalRefusedError):
        build_plan(db_session, "DEMO9", include_test_cards=False)
    assert db_session.scalar(select(Plant).where(Plant.code == "K134")) is not None


def test_test_cards_are_listed_and_removed_only_when_asked(
    boss: TestClient, db_session: Session
) -> None:
    create_plant(boss, db_session, "DEMO")
    boss.post("/api/v1/qr-test-cards", json={"label": "Gate test"})

    without = build_plan(db_session, "DEMO", include_test_cards=False)
    with_cards = build_plan(db_session, "DEMO", include_test_cards=True)

    assert without.card_ids == [] and without.test_card_labels == []
    assert len(with_cards.card_ids) == 1
    assert with_cards.test_card_labels[0].endswith("(Gate test)")
    remove(db_session, with_cards)
    db_session.commit()
    assert count(db_session, QrCredential) == 0


def test_the_ids_in_a_plan_belong_to_the_demo_plant_only(
    boss: TestClient, db_session: Session
) -> None:
    demo = create_plant(boss, db_session, "DEMO")
    real = create_plant(boss, db_session, "K134")
    Worker(boss, demo, "DEMO-1")
    other = Worker(boss, real, "REAL-1")

    plan = build_plan(db_session, "DEMO", include_test_cards=False)

    assert other.employee_id not in plan.employee_ids
    assert other.card_id not in plan.card_ids
    assert uuid.UUID(demo.id) == plan.plant_id


def test_face_consent_and_template_of_a_demo_employee_are_removed_too(
    boss: TestClient, db_session: Session
) -> None:
    from app.modules.face.models import FaceConsent, FaceTemplate
    from tests.face_helpers import enrol, new_employee, set_privacy

    set_privacy(db_session)
    demo = create_plant(boss, db_session, "DEMO3")
    employee_id = new_employee(boss, demo, "9001")
    assert enrol(boss, employee_id, person=3).status_code == 201
    assert count(db_session, FaceTemplate) == 1 and count(db_session, FaceConsent) == 1

    plan = build_plan(db_session, "DEMO3", include_test_cards=False)
    remove(db_session, plan)
    db_session.commit()

    assert count(db_session, FaceTemplate) == 0 and count(db_session, FaceConsent) == 0


def test_reviews_and_health_samples_of_a_demo_plant_are_removed_too(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    """M4: a reviewed demo punch and the heartbeats of a demo device must not block the removal,
    and the review table's "never change" protection is switched on again afterwards."""
    demo = create_plant(boss, db_session, "DEMO3")
    create_plant(boss, db_session, "K134")
    punch_once(boss, db_session, demo, "DEMO-1")
    punch = db_session.scalars(select(Punch)).one()
    user = db_session.scalars(select(User)).first()
    assert user is not None
    db_session.add(
        PunchReview(
            punch_id=punch.id,
            action="confirmed",
            employee_id=punch.employee_id,
            reviewed_by=user.id,
            reviewed_at=punch.server_received_at,
        )
    )
    db_session.add(
        KioskHeartbeat(
            kiosk_id=punch.kiosk_id,
            received_at=punch.server_received_at,
            queue_count=0,
            location_state="good",
        )
    )
    db_session.commit()

    plan = build_plan(db_session, "DEMO3", include_test_cards=False)
    assert plan.counts["reviews of those punches"] == 1
    assert plan.counts["device health samples"] == 1
    remove(db_session, plan)
    db_session.commit()

    assert count(db_session, PunchReview) == 0 and count(db_session, KioskHeartbeat) == 0
    assert count(db_session, Punch) == 0
    states = db_session.scalars(
        text(
            "SELECT tgenabled FROM pg_trigger "
            "WHERE tgrelid = 'punch_reviews'::regclass AND NOT tgisinternal"
        )
    ).all()
    assert states and set(states) == {"O"}  # the never-change protection is on again


def test_it_refuses_when_a_real_punch_points_at_a_demo_punch(
    boss: TestClient,
    db_session: Session,
    snapshot_folder: Path,  # noqa: F811
) -> None:
    demo = create_plant(boss, db_session, "DEMO4")
    real = create_plant(boss, db_session, "K134")
    punch_once(boss, db_session, demo, "DEMO-1")
    punch_once(boss, db_session, real, "REAL-1")
    demo_punch = db_session.scalars(select(Punch).where(Punch.plant_id == uuid.UUID(demo.id))).one()
    real_punch = db_session.scalars(select(Punch).where(Punch.plant_id == uuid.UUID(real.id))).one()
    # Punch rows never change; the test links them the way a stored flag would have.
    db_session.execute(text("ALTER TABLE punches DISABLE TRIGGER USER"))
    real_punch.related_punch_id = demo_punch.id
    db_session.commit()
    db_session.execute(text("ALTER TABLE punches ENABLE TRIGGER USER"))

    with pytest.raises(RemovalRefusedError, match="point at punches of this demo plant"):
        build_plan(db_session, "DEMO4", include_test_cards=False)
