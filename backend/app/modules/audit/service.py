"""Writes audit log entries (SRS FR-40, spec §7 rule 14).

Every service that changes data calls record_audit() inside the same database transaction
as the change, so a change without an audit entry cannot happen. Only changed fields are
kept, and secret fields are always replaced by "[hidden]".
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.core.logging import current_request_id
from app.modules.audit.models import AuditLog

HIDDEN = "[hidden]"
# Never stored in the audit log, not even as a hash (spec §7 rule 14).
SECRET_FIELDS = frozenset(
    {
        "password",
        "password_hash",
        "temporary_password",
        "token",
        "token_hash",
        "pairing_code",
        "code_hash",
        "public_key",
        "public_key_spki",
    }
)


@dataclass(frozen=True)
class Actor:
    """Who did something: a logged-in user, a kiosk device, or the system (jobs)."""

    actor_type: str  # "user" | "kiosk" | "system"
    actor_id: uuid.UUID | None
    ip: str | None = None


SYSTEM_ACTOR = Actor(actor_type="system", actor_id=None)


def to_json_safe(value: Any) -> Any:
    """Turn values the database returns (UUID, Decimal, dates…) into plain JSON values."""
    if isinstance(value, dict):
        return {str(key): to_json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set):
        return [to_json_safe(item) for item in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)  # exact, never a float
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return value


def hide_secrets(values: dict[str, Any] | None) -> dict[str, Any] | None:
    if values is None:
        return None
    return {key: HIDDEN if key in SECRET_FIELDS else value for key, value in values.items()}


def changed_fields(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Keep only the fields whose value changed. Creates and deletes keep everything."""
    if before is None or after is None:
        return before, after
    changed_keys = [key for key in after if before.get(key) != after.get(key)]
    return (
        {key: before.get(key) for key in changed_keys},
        {key: after[key] for key in changed_keys},
    )


def record_audit(
    session: Session,
    *,
    actor: Actor,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    plant_id: uuid.UUID | None = None,
    change_request_id: uuid.UUID | None = None,
) -> AuditLog:
    """Add one audit entry to the session. The caller commits together with its change."""
    safe_before = hide_secrets(to_json_safe(before))
    safe_after = hide_secrets(to_json_safe(after))
    safe_before, safe_after = changed_fields(safe_before, safe_after)

    entry = AuditLog(
        actor_type=actor.actor_type,
        actor_id=actor.actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        plant_id=plant_id,
        before=safe_before,
        after=safe_after,
        reason=reason,
        ip=_valid_ip_or_none(actor.ip),
        request_id=current_request_id.get(),
        change_request_id=change_request_id,
    )
    session.add(entry)
    return entry


def _valid_ip_or_none(ip: str | None) -> str | None:
    # The column type is INET; "unknown" (no client address) would be rejected.
    if ip is None or ip == "unknown":
        return None
    return ip
