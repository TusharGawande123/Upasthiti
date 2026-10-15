"""Password hashing (Argon2id) and the password rules from spec §7 rule 2."""

import secrets
import string

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.errors import ApiError

MINIMUM_LENGTH = 10
TEMPORARY_PASSWORD_LENGTH = 14
# Letters and digits that are easy to read aloud and type (no 0/O, 1/l/I).
TEMPORARY_PASSWORD_ALPHABET = "".join(
    character for character in string.ascii_letters + string.digits if character not in "0O1lI"
)
# A short list of passwords people often try; long lists are not worth the upkeep.
COMMON_PASSWORDS = frozenset(
    {
        "password123",
        "password@123",
        "1234567890",
        "qwertyuiop",
        "admin@1234",
        "admin12345",
        "welcome123",
        "welcome@123",
        "iloveyou123",
        "india@1234",
        "abcd@12345",
        "upasthiti123",
        "upasthiti@123",
        "sheetshapers",
        "sheetshapers123",
    }
)

# argon2-cffi's defaults are the recommended Argon2id settings.
_password_hasher = PasswordHasher()
# Used when a login name does not exist, so the answer takes as long as a real check and
# does not reveal which names exist.
_DUMMY_HASH = _password_hasher.hash("not-a-real-password-just-for-timing")


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerificationError, InvalidHashError:
        return False


def waste_time_like_a_password_check(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def needs_rehash(password_hash: str) -> bool:
    """True when the hashing settings got stronger since this hash was made."""
    return _password_hasher.check_needs_rehash(password_hash)


def check_password_rules(password: str, username: str, email: str | None) -> None:
    """Raise PASSWORD_TOO_WEAK with the broken rule in `details.rule`."""
    lowered = password.lower()
    if len(password) < MINIMUM_LENGTH:
        _too_weak("min_length")
    if password.isdigit():
        _too_weak("not_only_digits")
    if lowered == username.lower() or (email and lowered == email.lower()):
        _too_weak("not_login_name")
    if lowered in COMMON_PASSWORDS:
        _too_weak("too_common")


def generate_temporary_password() -> str:
    return "".join(
        secrets.choice(TEMPORARY_PASSWORD_ALPHABET) for _ in range(TEMPORARY_PASSWORD_LENGTH)
    )


def _too_weak(rule: str) -> None:
    raise ApiError(
        "PASSWORD_TOO_WEAK",
        "The new password does not follow the password rules.",
        422,
        {"rule": rule, "minimum_length": MINIMUM_LENGTH},
    )
