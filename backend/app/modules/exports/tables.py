"""What the full export contains: an explicit allow-list of columns per table (M6 spec 7.7).

Never `SELECT *`. A column is exported only when it is listed here. A column that is new in a later
milestone is NOT exported until someone adds it, and a test (test_m6_full_export.py) fails until
the new column is either listed here or listed in `EXCLUDED_COLUMNS` with the reason.

Never exported (spec 7.7 rule 7): face templates and enrolment pictures, password hashes, passkey
credentials, signing and encryption keys, device public keys, session tokens, nonces, one-time
codes, stored photo keys, offline evidence.
"""

# Tables that are left out as a whole: short-lived secrets and pictures.
EXCLUDED_TABLES: dict[str, str] = {
    "face_enrolment_shots": "encrypted enrolment pictures",
    "face_pending_matches": "encrypted short-lived face data",
    "kiosk_pairing_codes": "one-time codes",
    "phone_proofs": "one-time challenges and tokens",
    "punch_challenges": "one-time challenges",
    "sessions": "login session tokens",
}
# Columns that are left out of an exported table.
EXCLUDED_COLUMNS: dict[str, dict[str, str]] = {
    "face_templates": {"nonce": "face data", "ciphertext": "the sealed face template"},
    "phone_accounts": {"password_hash": "password hash"},
    "phone_passkeys": {
        "credential_id": "passkey credential",
        "public_key": "passkey public key",
        "user_handle": "passkey credential",
    },
    "phone_sessions": {"token_hash": "session token"},
    "kiosk_devices": {"public_key": "device key"},
    "punch_snapshots": {"storage_key": "where the photo is stored"},
    "users": {"password_hash": "password hash"},
}
# The key a table is read by, in batches (keyset paging); every table has `id` except settings.
KEY_COLUMN_OF_TABLE = {"settings": "key"}


def _columns(names: str) -> tuple[str, ...]:
    return tuple(names.split())


ALLOWED_COLUMNS: dict[str, tuple[str, ...]] = {
    "attendance_days": _columns(
        "id employee_id attendance_date plant_id shift_id shift_rule_version_id "
        "employee_type day_kind status leave_record_id holiday_id first_in last_out "
        "extra_punch_count worked_min payable_min status_min shift_length_min late_min "
        "early_exit_min overtime_min exceptions is_corrected uses_unchecked_flag "
        "calc_version stale computed_at"
    ),
    "audit_logs": _columns(
        "id at actor_type actor_id action entity_type entity_id plant_id before after "
        "reason ip request_id change_request_id"
    ),
    "change_requests": _columns(
        "id kind employee_id plant_ids payload summary status requested_by requested_at "
        "decided_by decided_at decision_reason result"
    ),
    "contractors": _columns("id name contact_name contact_phone is_active created_at updated_at"),
    "data_request_events": _columns(
        "id seq data_request_id event_type detail outcome audit_entry_id created_by created_at"
    ),
    "data_requests": _columns(
        "id kind employee_id channel received_on due_on note created_by created_at"
    ),
    "departments": _columns("id plant_id name is_active created_at updated_at"),
    "employee_categories": _columns("id plant_id name is_active created_at updated_at"),
    "employee_plant_history": _columns(
        "id employee_id plant_id category_id department_id from_date to_date reason "
        "created_by created_at"
    ),
    "employee_type_history": _columns(
        "id employee_id type from_date to_date contractor_id hourly_rate ot_rate_per_hour "
        "reason created_by created_at"
    ),
    "employees": _columns(
        "id employee_code full_name type plant_id category_id department_id contractor_id "
        "punch_method hourly_rate ot_rate_per_hour status joined_on left_on left_reason "
        "created_at updated_at"
    ),
    "face_consents": _columns(
        "id employee_id choice text_version language explained_language text_sha256 "
        "given_at recorded_by withdrawn_at withdrawn_by withdraw_kind withdraw_reason "
        "created_at updated_at"
    ),
    "face_enrolment_sessions": _columns(
        "id employee_id consent_id started_by started_at expires_at model_id state "
        "finished_template_id accepted_shots refused_shots straight_nose_ratio created_at "
        "updated_at"
    ),
    "face_templates": _columns(
        "id employee_id consent_id model_id key_id shot_count enrolled_by enrolled_at "
        "duplicate_override_reason duplicate_of_employee_id deleted_at deleted_by "
        "delete_kind delete_reason created_at updated_at"
    ),
    "geofences": _columns(
        "id plant_id version shape geojson radius_m buffer_m is_current created_by created_at"
    ),
    "holiday_plants": _columns("id holiday_id plant_id"),
    "holidays": _columns(
        "id date name is_paid all_plants created_by created_at cancelled_at cancelled_by "
        "cancel_reason"
    ),
    "kiosk_devices": _columns(
        "id plant_id name status registered_at registered_ip registered_lat "
        "registered_lon registered_accuracy_m last_seen_at last_counter app_version "
        "user_agent revoked_at revoke_reason sound_muted last_self_test_at "
        "last_heartbeat_at queue_count queue_bytes queue_oldest_at last_sync_at "
        "last_punch_at location_state last_lat last_lon last_accuracy_m last_location_at "
        "storage_persisted storage_quota_mb storage_usage_mb offline_ready battery_level "
        "battery_charging camera_ok created_at updated_at"
    ),
    "kiosk_heartbeats": _columns(
        "id kiosk_id received_at queue_count location_state accuracy_m battery_level "
        "battery_charging camera_ok storage_usage_mb app_version"
    ),
    "kiosk_notices": _columns(
        "id plant_id text level starts_at ends_at created_by ended_at ended_by created_at "
        "updated_at"
    ),
    "leave_records": _columns(
        "id employee_id from_date to_date is_paid reason created_by created_at "
        "cancelled_at cancelled_by cancel_reason"
    ),
    "notification_deliveries": _columns(
        "id notification_id user_id channel state attempted_at error_code"
    ),
    "notification_reads": _columns("id notification_id user_id read_at"),
    "notifications": _columns(
        "id kind severity plant_id target_user_id text_key params subject_ids link "
        "dedupe_key created_at resolved_at"
    ),
    "phone_access": _columns(
        "id employee_id phone_punch_enabled phone_changed_at phone_changed_by "
        "outside_work_allowed outside_work_until outside_changed_at outside_changed_by "
        "updated_at"
    ),
    "phone_accounts": _columns(
        "id employee_id password_set_at proof_kind failed_login_count locked_until "
        "new_password_required_at created_at updated_at"
    ),
    "phone_notice_acceptances": _columns(
        "id employee_id version language text_sha256 accepted_at session_id"
    ),
    "phone_passkeys": _columns(
        "id employee_id sign_count transports label created_at last_used_at removed_at "
        "removed_by remove_kind"
    ),
    "phone_sessions": _columns(
        "id employee_id created_at last_seen_at expires_at ip browser system user_agent "
        "revoked_at revoke_kind sign_in_method"
    ),
    "plant_weekly_offs": _columns("id plant_id weekday effective_from created_by created_at"),
    "plants": _columns(
        "id name code address lat lon is_active attendance_start_date created_at updated_at"
    ),
    "punch_reviews": _columns(
        "id punch_id action direction employee_id reason reviewed_by reviewed_at "
        "supersedes_review_id"
    ),
    "punch_snapshots": _columns(
        "id punch_id size_bytes width height brightness is_dark taken_at expires_at state "
        "purged_at reason face_found created_at updated_at"
    ),
    "punches": _columns(
        "id client_punch_id kiosk_id plant_id employee_id qr_credential_id method "
        "direction decision reason_codes server_received_at device_claimed_at was_offline "
        "lat lon accuracy_m ip app_version match_mode match_score second_best_score "
        "antispoof_score yaw_degrees challenge face_model_id follows_punch_id "
        "claimed_employee_id offline_punch_time time_proof device_counter location_age_s "
        "geofence_id geofence_distance_m related_punch_id early_out_mark punch_time "
        "channel phone_session_id location_plant_id"
    ),
    "qr_credentials": _columns(
        "id kind employee_id label card_serial key_id valid_from valid_until issued_by "
        "issued_at note revoked_at revoked_by revoke_kind revoke_reason print_count "
        "last_printed_at printed_plant_id last_used_at created_at updated_at"
    ),
    "regularisation_decisions": _columns(
        "id regularisation_id action reason note decided_by decided_at"
    ),
    "regularisations": _columns(
        "id employee_id attendance_date kind direction in_time out_time punch_id "
        "status_value reverses_id reason requested_by requested_at is_direct batch_id"
    ),
    "settings": _columns("key value updated_by updated_at"),
    "shift_assignments": _columns("id employee_id shift_id from_date to_date"),
    "shift_rule_versions": _columns(
        "id shift_id effective_from start_time end_time crosses_midnight grace_min "
        "grace_after_end_min half_day_min overtime_min_minutes created_by created_at"
    ),
    "shift_swaps": _columns(
        "id employee_id swap_date shift_id reason created_by created_at cancelled_at "
        "cancelled_by cancel_reason"
    ),
    "shifts": _columns(
        "id plant_id name start_time end_time crosses_midnight grace_min "
        "grace_after_end_min half_day_min overtime_min_minutes is_active created_at "
        "updated_at"
    ),
    "user_plant_access": _columns("id user_id plant_id"),
    "users": _columns(
        "id name username email role is_active must_change_password email_alerts_enabled "
        "email_alert_kinds failed_login_count locked_until last_login_at created_at "
        "updated_at"
    ),
}
