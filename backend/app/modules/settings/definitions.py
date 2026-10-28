"""Every configurable rule, with its default and allowed range (spec §7 rule 8, SRS FR-06).

Defaults live here in code; the `settings` table holds only values a Super Admin changed.
A setting is editable from the milestone that first uses it (`used_from`); before that the
screen shows it read-only, because changing it would have no effect yet.
"""

from dataclasses import dataclass

# Bump this in each milestone, so its settings become editable.
CURRENT_MILESTONE = 4

SettingValueType = int | float | str | None


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    # screen card: kiosk, kiosk_screen, punch, antiproxy, offline, face, privacy, snapshots,
    # cards, salary, security
    group: str
    default: SettingValueType
    unit: str
    used_from: int  # milestone number
    minimum: float | None = None
    maximum: float | None = None
    allowed_values: tuple[SettingValueType, ...] | None = None
    is_whole_number: bool = True
    # A text setting (company address, privacy contact): minimum and maximum are its length.
    is_text: bool = False
    # The value the accuracy report of slice D suggests (spec M3 §4.12, decision 0020); None until
    # that report is written, and the screen then says "No report yet".
    report_value: float | None = None

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
    # QR cards (M2, spec §7 rule 12).
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
    # After a card is read the person gets this long to look at the camera before the photo.
    SettingDefinition("kiosk_photo_ready_seconds", "kiosk_screen", 20, "s", 2, 5, 60),
    # Face recognition (M3, spec §7 rule 13). The defaults marked "provisional" are the spec's
    # starting values; the accuracy report of slice D replaces them before the milestone ends.
    # Matching: cosine similarity of face templates, from -1 to 1.
    # report_value 0.425 = the lowest threshold whose false-accept upper bound is under 0.1 %
    # (docs/reports/M3-face-accuracy.md, 27/10/2026). The default stays at 0.45: the data is
    # mostly non-Indian faces, which flatters the false-accept rate (decision 0024).
    SettingDefinition(
        "face_match_threshold",
        "face",
        0.45,
        "",
        3,
        0.20,
        0.90,
        is_whole_number=False,
        report_value=0.425,
    ),
    SettingDefinition("face_match_margin", "face", 0.08, "", 3, 0.0, 0.30, is_whole_number=False),
    SettingDefinition(
        "face_code_offer_floor", "face", 0.30, "", 3, 0.10, 0.80, is_whole_number=False
    ),
    SettingDefinition(
        "face_code_match_threshold", "face", 0.42, "", 3, 0.20, 0.90, is_whole_number=False
    ),
    SettingDefinition(
        "face_duplicate_threshold", "face", 0.45, "", 3, 0.20, 0.90, is_whole_number=False
    ),
    # Liveness and anti-spoof.
    SettingDefinition(
        "face_consistency_threshold", "face", 0.40, "", 3, 0.10, 0.90, is_whole_number=False
    ),
    SettingDefinition(
        "face_antispoof_threshold", "face", 0.80, "", 3, 0.10, 0.99, is_whole_number=False
    ),
    SettingDefinition("face_min_yaw_degrees", "face", 18, "degrees", 3, 10, 40),
    SettingDefinition("face_frontal_max_yaw_degrees", "face", 12, "degrees", 3, 5, 25),
    SettingDefinition("face_challenge_steps", "face", 1, "steps", 3, 1, 2),
    # Picture quality (pixels are counted at 640 pixels picture width).
    SettingDefinition("face_min_face_px", "face", 80, "px", 3, 40, 200),
    SettingDefinition("face_blur_min", "face", 40, "", 3, 5, 300),
    SettingDefinition("face_brightness_min", "face", 50, "of 255", 3, 20, 120),
    # Code entry and timing.
    SettingDefinition("face_challenge_seconds", "face", 10, "s", 3, 5, 30),
    SettingDefinition("face_code_entry_seconds", "face", 90, "s", 3, 30, 180),
    SettingDefinition("face_code_max_tries", "face", 2, "tries", 3, 1, 3),
    # Hints (F-41): when to suggest enrolling a face again.
    SettingDefinition("face_reenrol_code_count", "face", 3, "times in 30 days", 3, 1, 20),
    SettingDefinition(
        "face_reenrol_score_margin", "face", 0.05, "", 3, 0.0, 0.20, is_whole_number=False
    ),
    # Privacy (shown in the consent text). Both are empty until the Super Admin sets them;
    # the contact is filled with the first Super Admin when the system is set up (spec §7 rule 13).
    SettingDefinition("company_address", "privacy", "", "", 3, 5, 300, is_text=True),
    SettingDefinition("privacy_contact", "privacy", "", "", 3, 5, 200, is_text=True),
    # M4 (spec §7 rule 17): location on every punch, flag rules, offline gate devices.
    SettingDefinition("impossible_travel_kmh", "antiproxy", 60, "km/h", 4, 10, 200),
    SettingDefinition("impossible_travel_min_distance_m", "antiproxy", 500, "m", 4, 100, 5000),
    SettingDefinition("same_person_two_devices_minutes", "antiproxy", 10, "min", 4, 1, 60),
    SettingDefinition("review_hint_employee_rejections", "antiproxy", 3, "in 7 days", 4, 2, 20),
    SettingDefinition("review_hint_device_edge_flags", "antiproxy", 20, "in 7 days", 4, 5, 200),
    SettingDefinition("kiosk_location_max_age_seconds", "kiosk", 120, "s", 4, 30, 600),
    SettingDefinition("kiosk_location_refresh_seconds", "kiosk", 30, "s", 4, 10, 120),
    SettingDefinition("kiosk_offline_after_minutes", "offline", 3, "min", 4, 2, 30),
    SettingDefinition("kiosk_offline_alert_minutes", "offline", 10, "min", 4, 5, 120),
    SettingDefinition("offline_max_hours", "offline", 72, "h", 4, 24, 168),
    SettingDefinition("offline_queue_max_items", "offline", 2000, "punches", 4, 200, 10000),
    SettingDefinition("offline_queue_max_mb", "offline", 200, "MB", 4, 20, 1000),
    SettingDefinition("offline_clock_drift_seconds", "offline", 120, "s", 4, 30, 600),
    SettingDefinition(
        "salary_day_basis", "salary", 30, "days", 7, allowed_values=(26, 30, "actual")
    ),
)

DEFINITIONS_BY_KEY = {definition.key: definition for definition in SETTING_DEFINITIONS}
