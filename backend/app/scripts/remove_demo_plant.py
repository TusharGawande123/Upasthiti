"""Removes a DEMO plant and everything that was made for it, for good:

    uv run python -m app.scripts.remove_demo_plant --plant-code DEMO            (only shows)
    uv run python -m app.scripts.remove_demo_plant --plant-code DEMO --confirm  (deletes)

Why this exists: the lead tried the live site with a demo plant, a demo worker, cards and punches
and wants them gone. Normal screens never delete attendance, audit or people records (labour-law
record keeping, CLAUDE.md section 5), so this is a separate, deliberate tool with these rails:

- it works ONLY on a plant whose code starts with DEMO; a real plant (K134...) is refused;
- without --confirm it only prints what it would delete and changes nothing;
- with --confirm you must also type the plant code again;
- everything is deleted in ONE database transaction: all or nothing;
- the append-only protection of the punches table is switched off inside that transaction only
  and is on again when it ends. The audit log is NEVER touched: its rows about the demo stay
  (lead's decision, 2026-10-22), and one new audit row "demo_data.removed" (counts only, no
  names) records that this happened;
- the photo files in the storage bucket are deleted after the database commit.

Run it from the laptop with DATABASE_URL (and, for the photo files, STORAGE_BACKEND=supabase,
SUPABASE_URL, SUPABASE_SERVICE_KEY) set for this one command only; then remove them again.
"""

import argparse
import sys
import uuid
from dataclasses import dataclass, field

from sqlalchemy import Table, delete, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import load_settings_or_exit
from app.core.db import Base, get_session_factory
from app.core.storage import Storage, StorageError, get_storage
from app.modules import all_models  # noqa: F401  (makes every table known to Base.metadata)
from app.modules.audit.service import SYSTEM_ACTOR, record_audit

DEMO_PREFIX = "DEMO"


class RemovalRefusedError(Exception):
    """The plant is not a demo plant, or does not exist."""


@dataclass
class RemovalPlan:
    plant_id: uuid.UUID
    plant_code: str
    plant_name: str
    employee_ids: list[uuid.UUID] = field(default_factory=list)
    kiosk_ids: list[uuid.UUID] = field(default_factory=list)
    card_ids: list[uuid.UUID] = field(default_factory=list)
    test_card_labels: list[str] = field(default_factory=list)
    punch_ids: list[uuid.UUID] = field(default_factory=list)
    photo_keys: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _ids(session: Session, table: str, column: str, where) -> list[uuid.UUID]:
    target = _table(table)
    return list(session.scalars(select(target.c[column]).where(where)))


def build_plan(session: Session, plant_code: str, include_test_cards: bool) -> RemovalPlan:
    """Finds everything that belongs to the demo plant. Changes nothing."""
    code = plant_code.strip().upper()
    if not code.startswith(DEMO_PREFIX):
        raise RemovalRefusedError(
            f"Plant code {code!r} does not start with {DEMO_PREFIX}: "
            "only demo plants can be removed."
        )
    plants = _table("plants")
    plant = session.execute(select(plants.c.id, plants.c.name).where(plants.c.code == code)).first()
    if plant is None:
        raise RemovalRefusedError(f"There is no plant with the code {code!r}.")

    plan = RemovalPlan(plant_id=plant.id, plant_code=code, plant_name=plant.name)
    employees, kiosks = _table("employees"), _table("kiosk_devices")
    cards, punches = _table("qr_credentials"), _table("punches")
    snapshots = _table("punch_snapshots")

    plan.employee_ids = _ids(session, "employees", "id", employees.c.plant_id == plant.id)
    plan.kiosk_ids = _ids(session, "kiosk_devices", "id", kiosks.c.plant_id == plant.id)

    card_filter = cards.c.employee_id.in_(plan.employee_ids)
    if include_test_cards:
        # A test card belongs to nobody, so nothing links it to a plant: list them all and let the
        # person decide (--include-test-cards).
        card_filter = or_(card_filter, cards.c.kind == "test")
    plan.card_ids = _ids(session, "qr_credentials", "id", card_filter)
    if include_test_cards:
        rows = session.execute(
            select(cards.c.card_serial, cards.c.label).where(cards.c.kind == "test")
        ).all()
        plan.test_card_labels = [f"{row.card_serial} ({row.label or 'no label'})" for row in rows]

    plan.punch_ids = _ids(
        session,
        "punches",
        "id",
        or_(
            punches.c.plant_id == plant.id,
            punches.c.kiosk_id.in_(plan.kiosk_ids),
            punches.c.employee_id.in_(plan.employee_ids),
        ),
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
        "QR cards (incl. test cards if asked)": len(plan.card_ids),
        "punches": len(plan.punch_ids),
        "photos": len(plan.photo_keys),
    }
    return plan


def remove(session: Session, plan: RemovalPlan) -> None:
    """Deletes the plan's rows. The caller commits (or rolls everything back on an error)."""
    plant_id = plan.plant_id
    employee_ids, kiosk_ids = plan.employee_ids, plan.kiosk_ids

    # Only inside this transaction: switch the punches "never change or delete" trigger off, and
    # make sure it is on again (a rollback would undo this too).
    session.execute(text("ALTER TABLE punches DISABLE TRIGGER USER"))
    try:
        t = _table
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
                or_(
                    t("employee_plant_history").c.employee_id.in_(employee_ids),
                    t("employee_plant_history").c.plant_id == plant_id,
                )
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
        for table in (
            "kiosk_notices",
            "user_plant_access",
            "geofences",
            "shifts",
            "departments",
            "employee_categories",
        ):
            session.execute(delete(t(table)).where(t(table).c.plant_id == plant_id))
        session.execute(delete(t("plants")).where(t("plants").c.id == plant_id))
    finally:
        session.execute(text("ALTER TABLE punches ENABLE TRIGGER USER"))

    # One line that says it happened (counts only: no names, no codes of people).
    record_audit(
        session,
        actor=SYSTEM_ACTOR,
        action="demo_data.removed",
        entity_type="plant",
        entity_id=None,
        after={"plant_code": plan.plant_code, **plan.counts},
    )


def delete_photo_files(storage: Storage, keys: list[str]) -> list[str]:
    """Deletes the stored photos in batches; returns the keys that could not be deleted."""
    failed: list[str] = []
    for start in range(0, len(keys), 100):
        batch = keys[start : start + 100]
        try:
            storage.delete(batch)
        except StorageError, ValueError:
            failed.extend(batch)
    return failed


def _show(plan: RemovalPlan) -> None:
    print(f"Demo plant: {plan.plant_code} ({plan.plant_name})")
    for label, count in plan.counts.items():
        print(f"  {count:>5}  {label}")
    for label in plan.test_card_labels:
        print(f"         test card {label}")
    print("  Also: its geofences, shifts, departments, categories, notices, pairing codes,")
    print("        change requests and plant history. The audit log is not touched.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove a DEMO plant and all its data for good.")
    parser.add_argument("--plant-code", required=True, help="the demo plant code, e.g. DEMO")
    parser.add_argument(
        "--include-test-cards", action="store_true", help="also delete ALL test cards"
    )
    parser.add_argument("--skip-photos", action="store_true", help="do not delete the photo files")
    parser.add_argument("--confirm", action="store_true", help="really delete (default: only show)")
    arguments = parser.parse_args()

    load_settings_or_exit()
    storage = None if arguments.skip_photos else get_storage()
    with get_session_factory()() as session:
        try:
            plan = build_plan(session, arguments.plant_code, arguments.include_test_cards)
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
