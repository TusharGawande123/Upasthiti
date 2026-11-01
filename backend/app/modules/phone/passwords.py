"""The password rules for employees on the phone (M4b spec §7 rule 6).

Admins keep their own rules (app/modules/auth/passwords.py). Employees get a shorter minimum (8,
lead's answer 2) because many type on a small phone keyboard; hashing is the same Argon2id. The
broken rule goes into `details.rule`, never the password itself.
"""

from app.core.errors import ApiError
from app.modules.auth.passwords import COMMON_PASSWORDS

MINIMUM_LENGTH = 8
MAXIMUM_LENGTH = 128
# Easy guesses built from the code: "T-0877123", "t-0877@123".
CODE_ENDINGS = ("123", "@123")


def check_employee_password(password: str, employee_code: str) -> None:
    """Raise PASSWORD_TOO_WEAK with the first broken rule."""
    lowered = password.lower()
    code = employee_code.lower()
    if len(password) < MINIMUM_LENGTH:
        _too_weak("min_length")
    if len(password) > MAXIMUM_LENGTH:
        _too_weak("max_length")
    if password.isdigit():
        _too_weak("not_only_digits")
    if lowered == code:
        _too_weak("not_employee_code")
    easy_guesses = COMMON_PASSWORDS | {code + ending for ending in CODE_ENDINGS}
    if lowered in easy_guesses:
        _too_weak("too_common")


def _too_weak(rule: str) -> None:
    raise ApiError(
        "PASSWORD_TOO_WEAK",
        "The new password does not follow the password rules.",
        422,
        {"rule": rule, "minimum_length": MINIMUM_LENGTH},
    )
