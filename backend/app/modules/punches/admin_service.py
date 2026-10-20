"""Admin actions on punches that leave a trace: opening a photo (Super Admin only) and the Excel
export of one day (spec M2 §5.3, §7 rules 17 and 21).

Every photo view writes its own audit row: a photo shows a person, so who looked at it and when
is recorded (DPDP). The export holds text only: no photos, no IP address, no location.
"""

import io
import logging
from dataclasses import dataclass
from datetime import date

import xlsxwriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import SnapshotDecryptionError, decode_key, decrypt_snapshot
from app.core.errors import ApiError
from app.core.storage import ObjectNotFoundError, Storage, StorageError, get_storage
from app.core.time import to_ist
from app.modules.audit.service import Actor, record_audit
from app.modules.punches.models import Punch, PunchSnapshot, SnapshotState
from app.modules.punches.reasons import reason_text
from app.modules.punches.schemas import PunchLogItem

logger = logging.getLogger(__name__)

MAX_EXPORT_ROWS = 5_000


def _not_available() -> ApiError:
    return ApiError("SNAPSHOT_NOT_AVAILABLE", "No photo is available for this punch.", 404)


def read_snapshot(
    session: Session, actor: Actor, punch: Punch, storage: Storage | None = None
) -> bytes:
    """The punch's photo as a JPEG, decrypted on the server. Audited once per view."""
    snapshot = session.scalar(select(PunchSnapshot).where(PunchSnapshot.punch_id == punch.id))
    if snapshot is None or snapshot.state == SnapshotState.UPLOAD_FAILED.value:
        raise _not_available()
    if snapshot.state == SnapshotState.PURGED.value:
        raise ApiError("SNAPSHOT_PURGED", "This photo was deleted after the retention period.", 410)
    key_text = get_settings().snapshot_encryption_key
    if key_text is None:
        raise _not_available()
    try:
        stored = (storage or get_storage()).read(snapshot.storage_key)
    except ObjectNotFoundError:
        raise _not_available() from None
    except StorageError:
        raise ApiError(
            "STORAGE_UNAVAILABLE", "The photo store cannot be reached. Try again later.", 503
        ) from None
    try:
        jpeg = decrypt_snapshot(stored, punch.id, decode_key(key_text.get_secret_value()))
    except SnapshotDecryptionError:
        # A changed key or a damaged file. Logged for the admin; never shown as an image.
        logger.error(
            "A stored photo could not be decrypted", extra={"fields": {"punch_id": str(punch.id)}}
        )
        raise _not_available() from None

    record_audit(
        session,
        actor=actor,
        action="snapshot.view",
        entity_type="punch",
        entity_id=punch.id,
        after={"punch_id": str(punch.id), "taken_at": snapshot.taken_at.isoformat()},
        plant_id=punch.plant_id,
    )
    session.commit()
    return jpeg


# --- Excel export -------------------------------------------------------------------------------

COLUMNS = (
    ("Date", 12),
    ("Time", 10),
    ("Plant (kiosk)", 22),
    ("Employee code", 15),
    ("Name", 28),
    ("Kiosk", 22),
    ("Direction", 10),
    ("Result", 10),
    ("Reason code", 22),
    ("Reason", 36),
    ("Photo", 22),
)
HIDDEN_EMPLOYEE = "Card of another plant"


@dataclass(frozen=True)
class ExportedFile:
    content: bytes
    file_name: str
    rows: int


def _photo_text(item: PunchLogItem) -> str:
    match item.snapshot.state:
        case "stored":
            return "Photo stored"
        case "purged":
            purged = item.snapshot.purged_at
            return f"Photo deleted on {to_ist(purged):%d/%m/%Y}" if purged else "Photo deleted"
        case "upload_failed":
            return "Photo not saved"
        case _:
            return "No photo"


def _row(item: PunchLogItem) -> list[str]:
    moment = to_ist(item.server_received_at)
    if item.employee is not None:
        code, name = item.employee.code, item.employee.name
    elif item.employee_hidden:
        code, name = "", HIDDEN_EMPLOYEE
    else:
        code, name = "", "Unknown card"
    reason = item.reason_codes[0] if item.reason_codes else ""
    return [
        f"{moment:%d/%m/%Y}",
        f"{moment:%H:%M:%S}",
        f"{item.plant.code} · {item.plant.name}",
        code,
        name,
        item.kiosk.name,
        (item.direction or "").upper(),
        "Accepted" if item.decision == "accepted" else "Rejected",
        reason,
        reason_text(reason) if reason else "",
        _photo_text(item),
    ]


def build_export(items: list[PunchLogItem], day: date, plant_code: str | None) -> ExportedFile:
    if len(items) > MAX_EXPORT_ROWS:
        raise ApiError(
            "EXPORT_TOO_LARGE",
            f"At most {MAX_EXPORT_ROWS:,} punches per file. Choose one plant.",
            422,
            {"rows": len(items), "max_rows": MAX_EXPORT_ROWS},
        )
    buffer = io.BytesIO()
    # strings_to_formulas off + write_string: a cell such as "=HYPERLINK(...)" in a name stays
    # plain text and never runs as a formula (spreadsheet injection, M1 rule 12).
    workbook = xlsxwriter.Workbook(
        buffer, {"in_memory": True, "strings_to_formulas": False, "strings_to_urls": False}
    )
    sheet = workbook.add_worksheet("Punches")
    header = workbook.add_format({"bold": True, "bg_color": "#EAEEFB", "border": 1})
    for column, (title, width) in enumerate(COLUMNS):
        sheet.write_string(0, column, title, header)
        sheet.set_column(column, column, width)
    for row_number, item in enumerate(items, start=1):
        for column, value in enumerate(_row(item)):
            sheet.write_string(row_number, column, value)
    sheet.freeze_panes(1, 0)
    workbook.close()
    scope = plant_code or "all-plants"
    return ExportedFile(
        content=buffer.getvalue(), file_name=f"punches-{scope}-{day:%Y-%m-%d}.xlsx", rows=len(items)
    )


def record_export(
    session: Session, actor: Actor, filters: dict[str, str], rows: int, plant_id: object
) -> None:
    record_audit(
        session,
        actor=actor,
        action="punches.export",
        entity_type="punch",
        after={"filters": filters, "rows": rows},
        plant_id=plant_id,  # type: ignore[arg-type]
    )
    session.commit()
