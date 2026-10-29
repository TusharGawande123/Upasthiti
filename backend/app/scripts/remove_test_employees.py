"""Removes a few named TEST employees and TEST attendance devices of ONE plant, for good:

    uv run python -m app.scripts.remove_test_employees --plant-code K134 \
        --employee-codes 101 102 103 104 105 106 --device-names plant1 plant2     (only shows)
    ... the same line plus --confirm                                              (deletes)

Why this exists: during the real-device check of M4 (decision 0030) a few test employees and two
test devices were made in a REAL plant, so `remove_demo_plant` (DEMO plants only) refuses them. The
lead approved ONE deliberate exception (decision 0032). Normal screens never delete people, punches
or audit rows (labour-law record keeping, CLAUDE.md section 5).

The rails are the same as in `remove_demo_plant`, and narrower:

- it deletes ONLY the employee codes and device names you type, and only inside the plant you name.
  The plant itself, its geofence, shifts and every other employee stay;
- a code or name that does not exist in that plant stops the tool (a typo must not delete less or
  more than you meant); at most 20 employees per run;
- if a typed device holds punches of a person who is NOT in your list, the tool refuses: that
  would delete somebody else's attendance;
- without --confirm it only prints what it would delete; with --confirm you type the plant code
  again;
- everything is deleted in ONE database transaction: all or nothing;
- the append-only protection of the punches table is switched off inside that transaction only;
- the audit log is NEVER touched: one new line "test_data.removed" (counts only, no names) is added;
- the photo files in the storage bucket are deleted after the database commit.

Run it from the laptop with DATABASE_URL (and, for the photo files, STORAGE_BACKEND=supabase,
SUPABASE_URL, SUPABASE_SERVICE_KEY) set for this one command only; then remove them again.
"""

import argparse
import sys
import uuid

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.core.storage import get_storage
from app.modules import all_models  # noqa: F401  (makes every table known to Base.metadata)
from app.modules.audit.service import SYSTEM_ACTOR, record_audit

# One shared set of helpers keeps the two removal tools in step (same tables, same order).
from app.scripts.remove_demo_plant import (
    RemovalPlan,
    RemovalRefusedError,
    _ids,
    _remove_face_data,
    _table,
    delete_photo_files,
)

MAX_EMPLOYEES = 20


def _find_ids_by_value(
    session: Session, table: str, column: str, wanted: list[str], where
) -> tuple[list[uuid.UUID], list[str]]:
    """Returns the ids of the rows whose `column` matches `wanted` (any capitals), and the wanted
    values for which no row exists."""
    target = _table(table)
    rows = session.execute(select(target.c.id, target.c[column]).where(where)).all()
    found_by_value = {str(row[1]).strip().lower(): row[0] for row in rows}
    ids = [
        found_by_value[value.strip().lower()]
        for value in wanted
        if value.strip().lower() in found_by_value
    ]
    missing = [value for value in wanted if value.strip().lower() not in found_by_value]
    return ids, missing


def build_plan(
    session: Session, plant_code: str, employee_codes: list[str], device_names: list[str]
) -> RemovalPlan:
    """Finds everything that belongs to the named employees and devices. Changes nothing."""
    code = plant_code.strip().upper()
    plants = _table("plants")
    plant = session.execute(select(plants.c.id, plants.c.name).where(plants.c.code == code)).first()
    if plant is None:
        raise RemovalRefusedError(f"There is no plant with the code {code!r}.")
    if not employee_codes and not device_names:
        raise RemovalRefusedError("Give at least one employee code or one device name.")
    if len(employee_codes) > MAX_EMPLOYEES:
        raise RemovalRefusedError(
            f"{len(employee_codes)} employee codes given; at most {MAX_EMPLOYEES} per run."
        )

    plan = RemovalPlan(plant_id=plant.id, plant_code=code, plant_name=plant.name)
    employees, kiosks = _table("employees"), _table("kiosk_devices")
    cards, punches = _table("qr_credentials"), _table("punches")
    snapshots = _table("punch_snapshots")

    plan.employee_ids, missing_codes = _find_ids_by_value(
        session,
        "employees",
        "employee_code",
        employee_codes,
        employees.c.plant_id == plant.id,
    )
    plan.kiosk_ids, missing_names = _find_ids_by_value(
        session, "kiosk_devices", "name", device_names, kiosks.c.plant_id == plant.id
    )
    if missing_codes or missing_names:
        raise RemovalRefusedError(
            f"Not found in plant {code}: employee codes {missing_codes or '-'}, "
            f"device names {missing_names or '-'}. Nothing was changed."
        )

    plan.card_ids = _ids(
        session, "qr_credentials", "id", cards.c.employee_id.in_(plan.employee_ids)
    )
    plan.punch_ids = _ids(
        session,
        "punches",
        "id",
        or_(
            punches.c.kiosk_id.in_(plan.kiosk_ids),
            punches.c.employee_id.in_(plan.employee_ids),
            punches.c.claimed_employee_id.in_(plan.employee_ids),
        ),
    )

    # A punch of another person at a typed device is not ours to delete.
    strangers = session.scalar(
        select(func.count())
        .select_from(punches)
        .where(
            punches.c.id.in_(plan.punch_ids),
            or_(
                punches.c.employee_id.is_(None),
                punches.c.employee_id.not_in(plan.employee_ids),
            ),
            or_(
                punches.c.claimed_employee_id.is_(None),
                punches.c.claimed_employee_id.not_in(plan.employee_ids),
            ),
        )
    )
    if strangers:
        raise RemovalRefusedError(
            f"{strangers} punch(es) at the typed devices belong to people who are not in your list "
            "(or to nobody). Remove those devices from the list, or deal with those punches first."
        )

    reviews, heartbeats = _table("punch_reviews"), _table("kiosk_heartbeats")
    plan.review_ids = _ids(
        session,
        "punch_reviews",
        "id",
        or_(
            reviews.c.punch_id.in_(plan.punch_ids),
            reviews.c.employee_id.in_(plan.employee_ids),
        ),
    )
    plan.heartbeat_count = (
        session.scalar(
            select(func.count())
            .select_from(heartbeats)
            .where(heartbeats.c.kiosk_id.in_(plan.kiosk_ids))
        )
        or 0
    )
    # A punch that stays and points at a punch that goes (travel / two-devices flag, or the chain
    # of an offline punch) would make the delete fail half way: refuse it up front.
    linked_from_outside = session.scalar(
        select(func.count())
        .select_from(punches)
        .where(
            or_(
                punches.c.related_punch_id.in_(plan.punch_ids),
                punches.c.follows_punch_id.in_(plan.punch_ids),
            ),
            punches.c.id.not_in(plan.punch_ids),
        )
    )
    if linked_from_outside:
        raise RemovalRefusedError(
            f"{linked_from_outside} punch(es) that would stay point at punches that would be "
            "deleted (a travel, two-devices or offline link). Nothing was changed."
        )
    plan.photo_keys = [
        key
        for key in session.scalars(
            select(snapshots.c.storage_key).where(snapshots.c.punch_id.in_(plan.punch_ids))
        )
        if key
    ]
    plan.counts = {
        "employees": len(plan.employee_ids),
        "attendance devices": len(plan.kiosk_ids),
        "QR cards": len(plan.card_ids),
        "punches": len(plan.punch_ids),
        "photos": len(plan.photo_keys),
        "reviews of those punches": len(plan.review_ids),
        "device health samples": plan.heartbeat_count,
    }
    return plan


def remove(session: Session, plan: RemovalPlan) -> None:
    """Deletes the plan's rows. The caller commits (or rolls everything back on an error)."""
    employee_ids, kiosk_ids = plan.employee_ids, plan.kiosk_ids

    # Only inside this transaction: switch the punches "never change or delete" trigger off, and
    # make sure it is on again (a rollback would undo this too).
    session.execute(text("ALTER TABLE punches DISABLE TRIGGER USER"))
    session.execute(text("ALTER TABLE punch_reviews DISABLE TRIGGER USER"))
    try:
        t = _table
        _remove_face_data(session, plan)
        session.execute(
            delete(t("punch_reviews")).where(t("punch_reviews").c.id.in_(plan.review_ids))
        )
        session.execute(
            delete(t("kiosk_heartbeats")).where(t("kiosk_heartbeats").c.kiosk_id.in_(kiosk_ids))
        )
        session.execute(
            delete(t("punch_snapshots")).where(t("punch_snapshots").c.punch_id.in_(plan.punch_ids))
        )
        session.execute(delete(t("punches")).where(t("punches").c.id.in_(plan.punch_ids)))
        session.execute(
            delete(t("qr_credentials")).where(t("qr_credentials").c.id.in_(plan.card_ids))
        )
        session.execute(
            delete(t("shift_assignments")).where(
                t("shift_assignments").c.employee_id.in_(employee_ids)
            )
        )
        session.execute(
            delete(t("employee_plant_history")).where(
                t("employee_plant_history").c.employee_id.in_(employee_ids)
            )
        )
        session.execute(
            delete(t("change_requests")).where(t("change_requests").c.employee_id.in_(employee_ids))
        )
        session.execute(delete(t("employees")).where(t("employees").c.id.in_(employee_ids)))
        session.execute(
            delete(t("kiosk_pairing_codes")).where(
                t("kiosk_pairing_codes").c.kiosk_id.in_(kiosk_ids)
            )
        )
        session.execute(delete(t("kiosk_devices")).where(t("kiosk_devices").c.id.in_(kiosk_ids)))
    finally:
        session.execute(text("ALTER TABLE punches ENABLE TRIGGER USER"))
        session.execute(text("ALTER TABLE punch_reviews ENABLE TRIGGER USER"))

    # One line that says it happened (counts only: no names, no codes of people).
    record_audit(
        session,
        actor=SYSTEM_ACTOR,
        action="test_data.removed",
        entity_type="plant",
        entity_id=None,
        after={"plant_code": plan.plant_code, **plan.counts},
    )


def _show(plan: RemovalPlan) -> None:
    # Counts only: the typed codes are not printed again (they are people's data, and the person
    # running the tool typed them a moment ago). A wrong code stops the run before this point.
    print(f"Plant: {plan.plant_code} ({plan.plant_name}); the plant itself stays.")
    for label, count in plan.counts.items():
        print(f"  {count:>5}  {label}")
    print("  Also: their face data, shifts, plant history and change requests.")
    print("        The audit log is not touched.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Remove named TEST employees and devices of one plant for good."
    )
    parser.add_argument("--plant-code", required=True, help="the plant they belong to, e.g. K134")
    parser.add_argument("--employee-codes", nargs="*", default=[], help="e.g. 101 102 103")
    parser.add_argument("--device-names", nargs="*", default=[], help="e.g. plant1 plant2")
    parser.add_argument("--skip-photos", action="store_true", help="do not delete the photo files")
    parser.add_argument("--confirm", action="store_true", help="really delete (default: only show)")
    arguments = parser.parse_args()

    load_settings_or_exit()
    storage = None if arguments.skip_photos else get_storage()
    with get_session_factory()() as session:
        try:
            plan = build_plan(
                session, arguments.plant_code, arguments.employee_codes, arguments.device_names
            )
        except RemovalRefusedError as error:
            print(f"Refused: {error}")
            return 1
        _show(plan)
        if not arguments.confirm:
            print("\nNothing was changed. Run again with --confirm to delete all of this.")
            return 0
        if (
            input(f"\nType the plant code ({plan.plant_code}) to delete it for good: ").strip()
            != plan.plant_code
        ):
            print("Not the same code: nothing was changed.")
            return 1
        remove(session, plan)
        session.commit()

    print("Database rows deleted.")
    if storage is not None and plan.photo_keys:
        failed = delete_photo_files(storage, plan.photo_keys)
        print(
            f"Photo files deleted: {len(plan.photo_keys) - len(failed)}; "
            f"not deleted: {len(failed)}."
        )
        if failed:
            print("Delete these in Supabase > Storage > punch-snapshots by hand:")
            print("\n".join(failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
