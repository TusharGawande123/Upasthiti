"""Adds browser security headers to every API response.

Vercel adds the same headers to the website itself (frontend/vercel.json). They tell the
browser: always use HTTPS, never show our pages inside another site's frame, do not guess
file types, and allow the camera and location only for our own site.
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()",
}


def add_security_headers_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def set_security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        # API answers hold personal data and one-time passwords: browsers and proxies must not
        # keep a copy. (The health check is cheap and has no personal data, but the same rule
        # keeps the code simple.)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
