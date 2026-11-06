"""Finds the IP address of the browser or attendance device that sent a request.

This is the ONLY file that reads the connection address or a forwarding header (a test guards it).
Three ways to find the address, chosen by environment variables (spec M6 section 7.5):
1. CLIENT_IP_HEADER names a header that the outer proxy sets and the caller cannot write
   (one value, one IP). It is used as it is.
2. Else TRUSTED_PROXY_HOPS = n: each of our proxies appends the address it received the request
   from to X-Forwarded-For; we skip the n right-most entries and take the next one.
3. Else (or when the header does not fit) the address of the connection itself.
The value is used only for logs and rate limits, never as proof of location (decision 0005).
"""

import ipaddress
import logging

from fastapi import Request

from app.core.config import get_settings

FORWARDED_FOR_HEADER = "x-forwarded-for"
UNKNOWN_IP = "unknown"

logger = logging.getLogger(__name__)
_missing_header_warned = False


def pick_client_ip(
    forwarded_for: str | None,
    socket_ip: str | None,
    trusted_hops: int,
    single_value: str | None = None,
    use_single_value: bool = False,
) -> str:
    """Pure helper so the rule is easy to test. Anything that is not an IP is never used.

    `use_single_value` says that CLIENT_IP_HEADER is set (then `single_value` is its value, or
    None when the header is missing and the connection address is used).
    """
    socket_address = _valid_or_none(socket_ip or UNKNOWN_IP) or UNKNOWN_IP
    if use_single_value:
        candidate = _single_address(single_value)
    else:
        candidate = _address_from_hops(forwarded_for, socket_ip, trusted_hops)
    return candidate if candidate is not None else socket_address


def _single_address(value: str | None) -> str | None:
    # The proxy writes exactly one address. A comma means someone added a second one: refuse it.
    if value is None or "," in value:
        return None
    return _valid_or_none(value.strip())


def _address_from_hops(
    forwarded_for: str | None, socket_ip: str | None, trusted_hops: int
) -> str | None:
    if trusted_hops == 0 or not forwarded_for:
        return None

    # Example with 2 trusted hops: "client, vercel" + socket "render" -> addresses
    # [client, vercel, render]; the 2 right-most belong to our proxies, so "client" wins.
    addresses = [part.strip() for part in forwarded_for.split(",") if part.strip()]
    addresses.append(socket_ip or UNKNOWN_IP)
    if len(addresses) <= trusted_hops:
        # Fewer entries than proxies: the header cannot be ours. The first entry would be
        # written by the caller, so only the connection address is safe.
        return None
    return _valid_or_none(addresses[-(trusted_hops + 1)])


def _valid_or_none(address: str) -> str | None:
    # The header is written by the caller, so it may hold anything; only real IPs are kept.
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return None


def _warn_once_about_missing_header(header_name: str) -> None:
    """A set-up mistake (wrong header name, or the proxy was changed) would otherwise be silent:
    every limit would then count the proxy's address. One warning per process, no personal data."""
    global _missing_header_warned
    if _missing_header_warned:
        return
    _missing_header_warned = True
    logger.warning(
        "CLIENT_IP_HEADER is set but a request came without it; using the connection address",
        extra={"fields": {"header": header_name}},
    )


def get_client_ip(request: Request) -> str:
    settings = get_settings()
    socket_ip = request.client.host if request.client else None
    single_header = settings.client_ip_header
    single_value = request.headers.get(single_header) if single_header else None
    if single_header and single_value is None:
        _warn_once_about_missing_header(single_header)
    return pick_client_ip(
        request.headers.get(FORWARDED_FOR_HEADER),
        socket_ip,
        settings.trusted_proxy_hops,
        single_value=single_value,
        use_single_value=bool(single_header),
    )
