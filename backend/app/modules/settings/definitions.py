"""Every configurable rule, with its default and allowed range (spec §7 rule 8, SRS FR-06).

Defaults live here in code; the `settings` table holds only values a Super Admin changed.
A setting is editable from the milestone that first uses it (`used_from`); before that the
screen shows it read-only, because changing it would have no effect yet.
"""

from dataclasses import dataclass

# Bump this in each milestone, so its settings become editable.
CURRENT_MILESTONE = 2

SettingValueType = int | float | str | None


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    group: str  # screen card: kiosk, kiosk_screen, punch, face, snapshots, cards, salary, security
    default: SettingValueType
    unit: str
    used_from: int  # milestone number
    minimum: float | None = None
    maximum: float | None = None
    allowed_values: tuple[SettingValueType, ...] | None = None
    is_whole_number: bool = True

    @property
    def is_editable(self) -> bool:
        return self.used_from <= CURRENT_MILESTONE


SETTING_DEFINITIONS: tuple[SettingDefinition, ...] = (
    SettingDefinition("gps_accuracy_limit_m", "kiosk", 50, "m", 1, 10, 200),
    SettingDefinition("geofence_default_buffer_m", "kiosk", 25, "m", 1, 0, 200),
    SettingDefinition("pairing_code_minutes", "kiosk", 10, "min", 1, 5, 30),
    SettingDefinition("session_idle_minutes", "security", 60, "min", 1, 15, 240),
    SettingDefinition("session_max_hours", "security", 12, "h", 1, 4, 24),
    SettingDefinition("login_max_failures", "security", 5, "tries", 1, 3, 10),
    SettingDefinition("login_lock_minutes", "security", 15, "min", 1, 5, 120),
    SettingDefinition("punch_cooldown_minutes", "punch", 2, "min", 2, 1, 30),
    SettingDefinition("snapshot_retention_days", "snapshots", 60, "days", 2, 7, 365),
    # Used by the card punch rules (M2, spec §7 rule 12).
    SettingDefinition("min_minutes_before_out", "punch", 30, "min", 2, 2, 240),
    SettingDefinition("open_in_max_hours", "punch", 20, "h", 2, 12, 24),
    SettingDefinition("snapshot_dark_threshold", "snapshots", 40, "of 255", 2, 10, 120),
    # QR cards (M2, spec §7 rule 12). Editable once CURRENT_MILESTONE is raised to 2.
    SettingDefinition("qr_card_default_validity_months", "cards", 2, "months", 2, 1, 36),
    SettingDefinition("qr_card_expiring_soon_days", "cards", 14, "days", 2, 1, 60),
    # The kiosk screen (M2, F-1): tones, spoken line and how long a result stays on screen.
    SettingDefinition(
        "kiosk_voice_enabled", "kiosk_screen", "on", "", 2, allowed_values=("on", "off")
    ),
    SettingDefinition(
        "kiosk_sound_enabled", "kiosk_screen", "on", "", 2, allowed_values=("on", "off")
    ),
    SettingDefinition("kiosk_result_seconds", "kiosk_screen", 4, "s", 2, 2, 10),
    SettingDefinition("kiosk_reject_seconds", "kiosk_screen", 6, "s", 2, 3, 15),
    # The face values are chosen in M3 from the accuracy tests, so they have no default yet.
    SettingDefinition("face_match_threshold", "face", None, "", 3, 0, 1, is_whole_number=False),
    SettingDefinition("face_match_margin", "face", None, "", 3, 0, 1, is_whole_number=False),
    SettingDefinition("impossible_travel_kmh", "punch", 60, "km/h", 4, 10, 200),
    SettingDefinition(
        "salary_day_basis", "salary", 30, "days", 7, allowed_values=(26, 30, "actual")
    ),
)

DEFINITIONS_BY_KEY = {definition.key: definition for definition in SETTING_DEFINITIONS}
