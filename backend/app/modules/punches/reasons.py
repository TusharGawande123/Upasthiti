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
}


def reason_text(code: str) -> str:
    return REASON_TEXTS.get(code, code)
