"""Login (20) and pairing (10) limits per IP: only the end-to-end test server may raise them."""

import pytest

from app.core.config import get_settings
from app.modules.auth.rate_limit import (
    LOGINS_PER_IP,
    PAIRINGS_PER_IP,
    RateLimiter,
    login_limiter,
    pairing_limiter,
)


def test_limiter_accepts_a_fixed_number_or_a_function() -> None:
    assert RateLimiter(3, 60).max_attempts == 3
    assert RateLimiter(lambda: 7, 60).max_attempts == 7


def test_login_limit_is_20_outside_the_test_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "https://example.invalid")
    monkeypatch.setenv("E2E_LOGIN_LIMIT", "500")
    try:
        assert login_limiter.max_attempts == LOGINS_PER_IP == 20
    finally:
        get_settings.cache_clear()


def test_login_limit_can_be_raised_in_the_test_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("E2E_LOGIN_LIMIT", "500")
    try:
        assert login_limiter.max_attempts == 500
    finally:
        get_settings.cache_clear()


def test_pairing_limit_is_10_outside_the_test_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "https://example.invalid")
    monkeypatch.setenv("E2E_PAIRING_LIMIT", "200")
    try:
        assert pairing_limiter.max_attempts == PAIRINGS_PER_IP == 10
    finally:
        get_settings.cache_clear()


def test_pairing_limit_can_be_raised_in_the_test_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("E2E_PAIRING_LIMIT", "200")
    try:
        assert pairing_limiter.max_attempts == 200
    finally:
        get_settings.cache_clear()
