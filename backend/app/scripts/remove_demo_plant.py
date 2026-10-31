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

from sqlalchemy import Table, delete, func, or_, select, text, update
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
    review_ids: list[uuid.UUID] = field(default_factory=list)
    heartbeat_count: int = 0
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
            punches.c.claimed_employee_id.in_(plan.employee_ids),
        ),
    )
    # M4: reviews of those punches (append-only, like the punches) and the health samples of the
    # demo devices. A real punch that points at a demo punch (travel / two-devices flag) would
    # make the delete fail half way, so that case is refused up front.
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
    linked_from_outside = session.scalar(
        select(func.count())
        .select_from(punches)
        .where(
            punches.c.related_punch_id.in_(plan.punch_ids),
            punches.c.id.not_in(plan.punch_ids),
        )
    )
    if linked_from_outside:
        raise RemovalRefusedError(
            f"{linked_from_outside} punch(es) of other plants point at punches of this demo plant "
            "(a travel or two-devices flag). Remove or review those first."
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
        "reviews of those punches": len(plan.review_ids),
        "device health samples": plan.heartbeat_count,
    }
    return plan


def _remove_face_data(session: Session, plan: RemovalPlan) -> None:
    """Face consents, templates, enrolment sessions, waiting code matches and challenges of the
    demo plant go too: test faces must not stay behind (DPDP: erase when the purpose is over)."""
    t = _table
    session.execute(
        delete(t("face_pending_matches")).where(
            or_(
                t("face_pending_matches").c.origin_punch_id.in_(plan.punch_ids),
                t("face_pending_matches").c.kiosk_id.in_(plan.kiosk_ids),
            )
        )
    )
    session.execute(
        delete(t("punch_challenges")).where(t("punch_challenges").c.kiosk_id.in_(plan.kiosk_ids))
    )
    # A real employee's template may point at a demo employee as "duplicate of": unlink it.
    session.execute(
        update(t("face_templates"))
        .where(t("face_templates").c.duplicate_of_employee_id.in_(plan.employee_ids))
        .values(duplicate_of_employee_id=None)
    )
    # Sessions first (their shots go with them), then templates, then consents.
    session.execute(
        delete(t("face_enrolment_sessions")).where(
            t("face_enrolment_sessions").c.employee_id.in_(plan.employee_ids)
        )
    )
    session.execute(
        delete(t("face_templates")).where(t("face_templates").c.employee_id.in_(plan.employee_ids))
    )
    session.execute(
        delete(t("face_consents")).where(t("face_consents").c.employee_id.in_(plan.employee_ids))
    )


# Tables whose "never change or delete" trigger is switched off inside the removal transaction only
# (append-only or cancel-only; decision 0036 line 3).
PROTECTED_TABLES = (
    "punches",
    "punch_reviews",
    "shift_rule_versions",
    "plant_weekly_offs",
    "holidays",
    "holiday_plants",
    "leave_records",
)


def set_protection(session: Session, *, on: bool) -> None:
    """Switch the protecting triggers off (or on again) inside the current transaction only."""
    verb = "ENABLE" if on else "DISABLE"
    for table in PROTECTED_TABLES:
        session.execute(text(f"ALTER TABLE {table} {verb} TRIGGER USER"))


def remove_attendance_rows(session: Session, employee_ids: list[uuid.UUID]) -> None:
    """The M5 rows about the employees (leave so far). Both removal tools call it before the
    employees themselves go."""
    leave = _table("leave_records")
    session.execute(delete(leave).where(leave.c.employee_id.in_(employee_ids)))


def remove(session: Session, plan: RemovalPlan) -> None:
    """Deletes the plan's rows. The caller commits (or rolls everything back on an error)."""
    plant_id = plan.plant_id
    employee_ids, kiosk_ids = plan.employee_ids, plan.kiosk_ids

    # Only inside this transaction: switch the punches "never change or delete" trigger off, and
    # make sure it is on again (a rollback would undo this too).
    set_protection(session, on=False)
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
                or_(
                    t("employee_plant_history").c.employee_id.in_(employee_ids),
                    t("employee_plant_history").c.plant_id == plant_id,
                )
            )
        )
        session.execute(
            delete(t("change_requests")).where(t("change_requests").c.employee_id.in_(employee_ids))
        )
        remove_attendance_rows(session, employee_ids)
        session.execute(delete(t("employees")).where(t("employees").c.id.in_(employee_ids)))
        session.execute(
            delete(t("kiosk_pairing_codes")).where(
                t("kiosk_pairing_codes").c.kiosk_id.in_(kiosk_ids)
            )
        )
        session.execute(delete(t("kiosk_devices")).where(t("kiosk_devices").c.id.in_(kiosk_ids)))
        # M5: the dated shift rules and weekly offs of the plant (append-only, triggers off above).
        plant_shift_ids = select(t("shifts").c.id).where(t("shifts").c.plant_id == plant_id)
        session.execute(
            delete(t("shift_rule_versions")).where(
                t("shift_rule_versions").c.shift_id.in_(plant_shift_ids)
            )
        )
        _remove_plant_holidays(session, plant_id)
        for table in (
            "plant_weekly_offs",
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
        set_protection(session, on=True)

    # One line that says it happened (counts only: no names, no codes of people).
    record_audit(
        session,
        actor=SYSTEM_ACTOR,
        action="demo_data.removed",
        entity_type="plant",
        entity_id=None,
        after={"plant_code": plan.plant_code, **plan.counts},
    )


def _remove_plant_holidays(session: Session, plant_id: uuid.UUID) -> None:
    """The plant's entries in holidays chosen per plant; a holiday that was only for this plant
    is then for no plant at all, so it goes too. All-plant holidays stay."""
    holidays, holiday_plants = _table("holidays"), _table("holiday_plants")
    session.execute(delete(holiday_plants).where(holiday_plants.c.plant_id == plant_id))
    still_listed = select(holiday_plants.c.holiday_id)
    session.execute(
        delete(holidays).where(holidays.c.all_plants.is_(False), holidays.c.id.not_in(still_listed))
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
    print("  Also: its geofences, shifts and their rule versions, weekly offs, holidays only")
    print("        for this plant, leave, departments, categories, notices, pairing codes,")
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
