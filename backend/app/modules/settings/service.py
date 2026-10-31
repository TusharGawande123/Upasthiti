"""Reads and changes settings. Other modules call get_int_setting() for rule values."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist
from app.modules.audit.service import Actor, record_audit
from app.modules.org.models import Shift
from app.modules.org.shift_rules_service import shift_length_minutes
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
    _check_m4_pairs(session, checked_values)
    _check_window_fits_shifts(session, checked_values)

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
        if key == "attendance_window_before_hours":
            # Every window moves: the last 62 days of all plants are recomputed (rule 14).
            from app.modules.attendance.service import mark_plant_days_stale

            today = today_ist()
            mark_plant_days_stale(session, None, today - timedelta(days=62), today)
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


# (smaller, larger, message): after a save, `smaller` must stay below (or at) `larger`.
_M4_ORDERED_PAIRS = (
    (
        "kiosk_offline_after_minutes",
        "kiosk_offline_alert_minutes",
        "The alert time cannot be shorter than the offline time.",
    ),
    (
        "kiosk_location_refresh_seconds",
        "kiosk_location_max_age_seconds",
        "The refresh time must be shorter than the maximum age.",
    ),
)


def _check_m4_pairs(session: Session, new_values: dict[str, SettingValueType]) -> None:
    """Two M4 settings only make sense in order (spec M4 §7 rule 17): the offline alert comes
    after a device counts as offline, and the location is refreshed before it gets too old."""
    for smaller_key, larger_key, message in _M4_ORDERED_PAIRS:
        if smaller_key not in new_values and larger_key not in new_values:
            continue
        smaller = _int_after_save(session, new_values, smaller_key)
        larger = _int_after_save(session, new_values, larger_key)
        too_close = smaller >= larger if "refresh" in smaller_key else smaller > larger
        if too_close:
            raise ApiError("SETTING_INVALID", message, 422, {"key": larger_key})


def _check_window_fits_shifts(session: Session, new_values: dict[str, SettingValueType]) -> None:
    """The day window starts N hours before a shift (M5 spec §7 rules 5 and 16). N must stay
    below 24 hours minus the longest active shift, so a window never starts before the previous
    shift has ended."""
    value = new_values.get("attendance_window_before_hours")
    if not isinstance(value, int | float):
        return
    longest = max(
        (
            shift_length_minutes(start, end)
            for start, end in session.execute(
                select(Shift.start_time, Shift.end_time).where(Shift.is_active.is_(True))
            )
        ),
        default=0,
    )
    if value * 60 >= 24 * 60 - longest:
        raise ApiError(
            "SETTING_INVALID",
            "The day window must start after the longest shift of the day before has ended.",
            422,
            {"key": "attendance_window_before_hours", "longest_shift_min": longest},
        )


def _int_after_save(session: Session, new_values: dict[str, SettingValueType], key: str) -> int:
    value = new_values.get(key)
    return int(value) if isinstance(value, int | float) else get_int_setting(session, key)


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
