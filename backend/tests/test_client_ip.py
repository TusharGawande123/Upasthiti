"""The client IP is read from X-Forwarded-For only as far as our own proxies are trusted."""

import pytest

from app.core.client_ip import pick_client_ip


@pytest.mark.parametrize(
    ("forwarded_for", "socket_ip", "trusted_hops", "expected"),
    [
        # No proxies trusted: the header is ignored, so it cannot be faked.
        ("1.1.1.1", "10.0.0.9", 0, "10.0.0.9"),
        # Vercel + Render: header "client, vercel", socket = Render's proxy.
        ("203.0.113.7, 76.76.21.1", "10.0.0.9", 2, "203.0.113.7"),
        # A faked first entry is skipped when it sits left of the trusted hops.
        ("6.6.6.6, 203.0.113.7, 76.76.21.1", "10.0.0.9", 2, "203.0.113.7"),
        ("203.0.113.7", "10.0.0.9", 1, "203.0.113.7"),
        # Fewer addresses than trusted hops: take the left-most one.
        ("203.0.113.7", "10.0.0.9", 3, "203.0.113.7"),
        (None, "10.0.0.9", 2, "10.0.0.9"),
        (None, None, 0, "unknown"),
        # Junk in the header or a test client name is never passed on.
        ("not-an-ip, 76.76.21.1", "10.0.0.9", 2, "unknown"),
        (None, "testclient", 0, "unknown"),
    ],
)
def test_pick_client_ip(
    forwarded_for: str | None, socket_ip: str | None, trusted_hops: int, expected: str
) -> None:
    assert pick_client_ip(forwarded_for, socket_ip, trusted_hops) == expected
