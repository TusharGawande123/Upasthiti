"""The in-memory limits of the phone pages (M4b spec §7 rule 8).

They work like the admin login limits (app/modules/auth/rate_limit.py): counts per process, lost
at a restart. The durable protection is the per-account lockout in the database (rule 7).
"""

from app.core.config import get_settings
from app.modules.auth.rate_limit import LOGINS_PER_IP, TEN_MINUTES, RateLimiter

ONE_HOUR = 60 * 60
# The key of the global limit: failed proofs from ANYONE. The client IP can be faked behind
# Vercel, so this cap protects the single face worker and stops guessing whatever the IP says.
EVERYONE = "all"


def _sign_in_limit() -> int:
    settings = get_settings()
    # Only the end-to-end test server may raise it (a whole test run signs in from one laptop).
    return settings.e2e_login_limit if settings.app_env == "test" else LOGINS_PER_IP


# Password sign-ins AND passkey sign-ins (options + answer) per IP: 20 in 10 minutes.
phone_sign_in_limiter = RateLimiter(max_attempts=_sign_in_limit, window_seconds=TEN_MINUTES)
# Face challenges, face proofs and card proofs per IP: 10 in 10 minutes.
proof_ip_limiter = RateLimiter(max_attempts=10, window_seconds=TEN_MINUTES)
# Face proofs per typed employee code: 5 an hour.
face_proof_code_limiter = RateLimiter(max_attempts=5, window_seconds=ONE_HOUR)
# Failed proofs from everyone together: 60 in 10 minutes.
failed_proof_limiter = RateLimiter(max_attempts=60, window_seconds=TEN_MINUTES)
# "Set your password" per IP: 10 in 10 minutes.
password_set_limiter = RateLimiter(max_attempts=10, window_seconds=TEN_MINUTES)
# Passkey adds per sign-in: 5 an hour.
passkey_add_limiter = RateLimiter(max_attempts=5, window_seconds=ONE_HOUR)

ALL_PHONE_LIMITERS = (
    phone_sign_in_limiter,
    proof_ip_limiter,
    face_proof_code_limiter,
    failed_proof_limiter,
    password_set_limiter,
    passkey_add_limiter,
)


def reset_phone_limits() -> None:
    """Tests start every case with empty counters."""
    for limiter in ALL_PHONE_LIMITERS:
        limiter.reset()
