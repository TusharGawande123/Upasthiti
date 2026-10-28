"""Short English texts for the punch reason codes, for the Excel export (spec M2 §7 rules 10, 21).
The admin screens use the same wording from the translation file (`punchReasons.<CODE>`)."""

REASON_TEXTS: dict[str, str] = {
    "SNAPSHOT_MISSING": "No photo was sent",
    "SNAPSHOT_INVALID": "The photo was not usable",
    "QR_FORMAT_INVALID": "The card could not be read",
    "QR_SIGNATURE_INVALID": "Not a valid Upasthiti card",
    "QR_REVOKED": "Card blocked",
    "QR_NOT_YET_VALID": "Card not active yet",
    "QR_EXPIRED": "Card expired",
    "EMPLOYEE_INACTIVE": "Employee has left",
    "EMPLOYEE_NOT_QR": "Employee punches by face",
    "WRONG_PLANT": "Card of another plant",
    "COOLDOWN_ACTIVE": "Already punched (scanned again too soon)",
    "OUT_TOO_SOON": "Already IN (OUT not allowed yet)",
    # M4 rejections (spec §7 rule 18)
    "LOCATION_REQUIRED": "No location sent",
    "GPS_ACCURACY_TOO_LOW": "Location not accurate enough",
    "OUTSIDE_GEOFENCE": "Outside the plant fence",
    "GEOFENCE_NOT_SET": "The plant has no fence",
    "OFFLINE_CHALLENGE_INVALID": "Saved face punch had no valid head turn",
    "OFFLINE_EVIDENCE_UNREADABLE": "Saved punch could not be read",
    # M4 flags: the punch counts, the Super Admin checks it later
    "LOCATION_AT_EDGE": "At the edge of the fence",
    "LOCATION_STALE": "Location reading was old",
    "IMPOSSIBLE_TRAVEL": "Impossible travel",
    "TWO_DEVICES_SOON": "Two attendance devices, minutes apart",
    "OFFLINE_TIME_UNPROVEN": "Time not proven",
    "OFFLINE_TOO_OLD": "Saved offline for too long",
    "SYNC_ORDER_CONFLICT": "Order changed after sending",
}


def reason_text(code: str) -> str:
    return REASON_TEXTS.get(code, code)
