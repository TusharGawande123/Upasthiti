"""Finds the IP address of the browser or kiosk that sent a request.

Requests reach the backend through proxies (Vercel, then Render). Each proxy appends the
address it received the request from to the X-Forwarded-For header. With
TRUSTED_PROXY_HOPS = n we skip the n right-most entries our own proxies added and take the
next one. The value can still be faked by calling the backend directly, so it is used only
for logs and rate limits, never as proof of location (decision 0005).
"""

import ipaddress

from fastapi import Request

from app.core.config import get_settings

FORWARDED_FOR_HEADER = "x-forwarded-for"
UNKNOWN_IP = "unknown"


def pick_client_ip(forwarded_for: str | None, socket_ip: str | None, trusted_hops: int) -> str:
    """Pure helper so the rule is easy to test. Anything that is not an IP becomes "unknown"."""
    return _valid_or_unknown(_pick_address(forwarded_for, socket_ip, trusted_hops))


def _pick_address(forwarded_for: str | None, socket_ip: str | None, trusted_hops: int) -> str:
    socket_address = socket_ip or UNKNOWN_IP
    if trusted_hops == 0 or not forwarded_for:
        return socket_address

    # Example with 2 trusted hops: "client, vercel" + socket "render" -> addresses
    # [client, vercel, render]; the 2 right-most belong to our proxies, so "client" wins.
    addresses = [part.strip() for part in forwarded_for.split(",") if part.strip()]
    addresses.append(socket_address)
    if len(addresses) <= trusted_hops:
        return addresses[0]
    return addresses[-(trusted_hops + 1)]


def _valid_or_unknown(address: str) -> str:
    # The header is written by the caller, so it may hold anything; only real IPs are kept.
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return UNKNOWN_IP


def get_client_ip(request: Request) -> str:
    socket_ip = request.client.host if request.client else None
    return pick_client_ip(
        request.headers.get(FORWARDED_FOR_HEADER),
        socket_ip,
        get_settings().trusted_proxy_hops,
    )
