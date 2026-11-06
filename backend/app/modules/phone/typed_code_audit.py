"""What the audit log keeps of an employee code that someone typed on the phone (M6 decision 0038).

A code that belongs to a real employee is kept as typed (the audit row already names the
employee). A code that belongs to nobody may be anything, for example a password typed into the
wrong box, so the log keeps only a keyed hash (HMAC-SHA256) and the length. The Super Admin can
still check a guess ("was it 1043?") by hashing it with the same key, but the text is not kept.
"""

import hashlib
import hmac

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings
from app.modules.employees.rules import clean_code

# Names this one use of the secret, so the key made here is never the key of anything else.
HKDF_INFO = b"upasthiti typed-code audit hmac v1"


def typed_code_key() -> bytes:
    """A 32-byte key derived from APP_SECRET_KEY, so no new environment variable is needed."""
    secret = get_settings().app_secret_key.encode("utf-8")
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(secret)


def typed_code_hmac(code: str) -> str:
    return hmac.new(typed_code_key(), clean_code(code).encode("utf-8"), hashlib.sha256).hexdigest()


def audit_fields_for_typed_code(code: str, *, employee_known: bool) -> dict[str, str | int]:
    """Audit fields for a typed code: the code for a known employee, else HMAC and length."""
    if employee_known:
        return {"code": clean_code(code)[:12]}
    return {"code_hmac": typed_code_hmac(code), "code_length": len(code.strip())}
