"""counting.py stays the one definition of "counts" (M5 spec §7 rule 2, AC-14, AC-15): the bulk
function for many employees returns exactly what the single-employee function returns.
Real PostgreSQL, fake data, fixed seed."""

import random
import uuid
from datetime import datetime, timedelta

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import IST
from app.modules.kiosks.models import KioskDevice
from app.modules.punches.counting import counted_between, counted_for_employees
from app.modules.punches.models import Punch, PunchReview
from app.modules.users.models import Role, User
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.people_helpers import client_for, create_plant
from tests.test_punch_api import Worker

START = datetime(2026, 10, 28, 5, 0, tzinfo=IST)
END = START + timedelta(days=2)


def add_punch(
    session: Session,
    kiosk: KioskDevice,
    employee_id: uuid.UUID | None,
    moment: datetime,
    decision: str,
    direction: str | None,
) -> Punch:
    punch = Punch(
        client_punch_id=uuid.uuid4(),
        kiosk_id=kiosk.id,
        plant_id=kiosk.plant_id,
        employee_id=employee_id,
        method="face",
        direction=direction if decision in ("accepted", "flagged") else None,
        decision=decision,
        reason_codes=[] if decision == "accepted" else ["LOCATION_AT_EDGE"],
        server_received_at=moment,
        was_offline=False,
    )
    session.add(punch)
    session.flush()
    return punch


def add_review(
    session: Session,
    punch: Punch,
    reviewer: uuid.UUID,
    action: str,
    *,
    employee_id: uuid.UUID | None = None,
    direction: str | None = None,
    supersedes: PunchReview | None = None,
) -> PunchReview:
    review = PunchReview(
        punch_id=punch.id,
        action=action,
        direction=direction if action == "approved" else None,
        employee_id=employee_id,
        reason=None if action == "confirmed" else "Checked by the office",
        reviewed_by=reviewer,
        reviewed_at=punch.server_received_at + timedelta(hours=1),
        supersedes_review_id=supersedes.id if supersedes else None,
    )
    session.add(review)
    session.flush()
    return review


def single_view(session: Session, employee_ids: list[uuid.UUID]) -> set[tuple]:
    return {
        (employee_id, item.punch.id, item.direction)
        for employee_id in employee_ids
        for item in counted_between(session, employee_id, START, END)
    }


def bulk_view(session: Session, employee_ids: list[uuid.UUID]) -> set[tuple]:
    return {
        (item.employee_id, item.punch.id, item.direction)
        for item in counted_for_employees(session, employee_ids, START, END)
    }


def test_bulk_and_single_counting_agree_on_a_random_mix(
    db_app: FastAPI, db_session: Session
) -> None:
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    reviewer = db_session.scalars(select(User.id).where(User.username == "boss")).one()
    plant = create_plant(boss, db_session, "DEMO1")
    kiosk = make_active_kiosk(db_session, plant, Device())
    workers: list[Worker] = [Worker(boss, plant, f"W-{n}") for n in range(4)]
    employee_ids = [worker.employee_id for worker in workers]
    chooser = random.Random(5)  # noqa: S311  (test data, fixed seed: the same mix on every run)

    for number in range(60):
        moment = START + timedelta(minutes=37 * number)
        named = chooser.choice([*employee_ids, None])
        decision = chooser.choice(["accepted", "flagged", "rejected", "needs_code"])
        direction = chooser.choice(["in", "out"])
        punch = add_punch(db_session, kiosk, named, moment, decision, direction)
        kind = chooser.choice(["none", "confirm", "not_accepted", "approve", "approve_then_undo"])
        if kind == "none" or decision in ("accepted", "needs_code"):
            continue
        if kind == "approve" or kind == "approve_then_undo":
            approved = add_review(
                db_session,
                punch,
                reviewer,
                "approved",
                employee_id=named or chooser.choice(employee_ids),
                direction=chooser.choice(["in", "out"]),
            )
            if kind == "approve_then_undo":
                add_review(db_session, punch, reviewer, "not_accepted", supersedes=approved)
        else:
            add_review(
                db_session, punch, reviewer, "confirmed" if kind == "confirm" else "not_accepted"
            )
    db_session.commit()

    single = single_view(db_session, employee_ids)
    assert single  # the mix really has counted punches
    assert bulk_view(db_session, employee_ids) == single
    # Asking for a subset gives only those employees.
    assert bulk_view(db_session, employee_ids[:1]) == single_view(db_session, employee_ids[:1])


def test_an_approved_nameless_punch_counts_only_for_the_approved_employee(
    db_app: FastAPI, db_session: Session
) -> None:
    """AC-14 (E21): a rejected face punch that names nobody, approved as IN for X."""
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    reviewer = db_session.scalars(select(User.id).where(User.username == "boss")).one()
    plant = create_plant(boss, db_session, "DEMO1")
    kiosk = make_active_kiosk(db_session, plant, Device())
    x = Worker(boss, plant, "X-1")
    y = Worker(boss, plant, "Y-1")
    punch = add_punch(db_session, kiosk, None, START + timedelta(hours=4), "rejected", None)
    add_review(db_session, punch, reviewer, "approved", employee_id=x.employee_id, direction="in")
    db_session.commit()

    counted = counted_for_employees(db_session, [x.employee_id, y.employee_id], START, END)

    assert [(item.employee_id, item.direction) for item in counted] == [(x.employee_id, "in")]
    assert counted_for_employees(db_session, [], START, END) == []
