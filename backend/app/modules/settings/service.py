"""Reads and changes settings. Other modules call get_int_setting() for rule values."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.audit.service import Actor, record_audit
from app.modules.punches.retention import shorten_snapshot_expiry
from app.modules.settings.definitions import (
    DEFINITIONS_BY_KEY,
    SETTING_DEFINITIONS,
    SettingDefinition,
    SettingValueType,
)
from app.modules.settings.models import SettingValue


@dataclass(frozen=True)
class CurrentSetting:
    definition: SettingDefinition
    value: SettingValueType


def get_setting(session: Session, key: str) -> SettingValueType:
    definition = DEFINITIONS_BY_KEY[key]
    stored = session.get(SettingValue, key)
    return definition.default if stored is None else stored.value


def get_int_setting(session: Session, key: str) -> int:
    value = get_setting(session, key)
    if not isinstance(value, int):
        raise TypeError(f"Setting {key} is not a whole number")
    return value


def get_float_setting(session: Session, key: str) -> float:
    value = get_setting(session, key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"Setting {key} is not a number")
    return float(value)


def get_text_setting(session: Session, key: str) -> str:
    value = get_setting(session, key)
    if not isinstance(value, str):
        raise TypeError(f"Setting {key} is not text")
    return value


def list_settings(session: Session) -> list[CurrentSetting]:
    stored_values = {row.key: row.value for row in session.scalars(select(SettingValue))}
    return [
        CurrentSetting(definition, stored_values.get(definition.key, definition.default))
        for definition in SETTING_DEFINITIONS
    ]


def update_settings(
    session: Session, *, actor: Actor, new_values: dict[str, Any], reason: str
) -> list[CurrentSetting]:
    """Check every value first, then save them all together with one audit entry each."""
    checked_values = {key: _check_value(key, value) for key, value in new_values.items()}
    _check_face_floor(session, checked_values)

    for key, value in checked_values.items():
        stored = session.get(SettingValue, key)
        old_value = DEFINITIONS_BY_KEY[key].default if stored is None else stored.value
        if old_value == value:
            continue
        if stored is None:
            session.add(SettingValue(key=key, value=value, updated_by=actor.actor_id))
        else:
            stored.value = value
            stored.updated_by = actor.actor_id
        record_audit(
            session,
            actor=actor,
            action="settings.update",
            entity_type="setting",
            before={"key": key, "value": old_value},
            after={"key": key, "value": value},
            reason=reason,
        )
        if key == "snapshot_retention_days" and isinstance(value, int):
            # Lowering the retention also shortens photos that are already stored (spec §7
            # rule 4). Raising it only affects new photos.
            shorten_snapshot_expiry(session, value)
    session.commit()
    return list_settings(session)


def _check_value(key: str, value: Any) -> SettingValueType:
    definition = DEFINITIONS_BY_KEY.get(key)
    if definition is None:
        raise ApiError("SETTING_UNKNOWN", "This setting does not exist.", 422, {"key": key})
    if not definition.is_editable:
        raise ApiError(
            "SETTING_NOT_EDITABLE_YET",
            "This setting is used from a later milestone.",
            422,
            {"key": key, "used_from": definition.used_from},
        )
    if definition.allowed_values is not None:
        if value not in definition.allowed_values:
            raise _out_of_range(definition)
        return value
    if definition.is_text:
        return _check_text(definition, value)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _out_of_range(definition)
    if definition.is_whole_number and not float(value).is_integer():
        raise _out_of_range(definition)
    if definition.minimum is not None and value < definition.minimum:
        raise _out_of_range(definition)
    if definition.maximum is not None and value > definition.maximum:
        raise _out_of_range(definition)
    return int(value) if definition.is_whole_number else float(value)


def _check_text(definition: SettingDefinition, value: Any) -> str:
    """A text setting: trimmed, and its length must be inside the allowed range."""
    if not isinstance(value, str):
        raise _out_of_range(definition)
    text = value.strip()
    if (
        definition.minimum is not None
        and len(text) < definition.minimum
        or definition.maximum is not None
        and len(text) > definition.maximum
    ):
        raise _out_of_range(definition)
    return text


def _check_face_floor(session: Session, new_values: dict[str, SettingValueType]) -> None:
    """The code-entry floor must not be above the match threshold, or a face could be "unsure"
    without ever being "matched" (spec M3 §7 rule 13). The 1:1 code threshold must not be below
    the floor either: employee codes are not secret, so a lower bar would let a face that was
    never "unsure" be accepted with a coworker's code. Checked on the values after this save."""
    watched = ("face_code_offer_floor", "face_match_threshold", "face_code_match_threshold")
    if not any(key in new_values for key in watched):
        return

    def after_save(key: str) -> float:
        value = new_values.get(key)
        return float(value) if isinstance(value, int | float) else get_float_setting(session, key)

    if after_save("face_code_offer_floor") > after_save("face_match_threshold"):
        raise ApiError(
            "SETTING_INVALID",
            "The code-entry floor must be lower than the match threshold.",
            422,
            {"key": "face_code_offer_floor"},
        )
    if after_save("face_code_match_threshold") < after_save("face_code_offer_floor"):
        raise ApiError(
            "SETTING_INVALID",
            "The code threshold must not be lower than the code-entry floor.",
            422,
            {"key": "face_code_match_threshold"},
        )


def _out_of_range(definition: SettingDefinition) -> ApiError:
    return ApiError(
        "SETTING_OUT_OF_RANGE",
        "This value is outside the allowed range.",
        422,
        {
            "key": definition.key,
            "minimum": definition.minimum,
            "maximum": definition.maximum,
            "allowed_values": list(definition.allowed_values or []),
        },
    )
