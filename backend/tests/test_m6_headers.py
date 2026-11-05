"""M6 AC-M6-17: security headers of the API, of frontend/vercel.json and of the proxy samples."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parent.parent.parent
VERCEL_JSON = REPO / "frontend" / "vercel.json"
PROXY_SAMPLES = REPO / "docs" / "guides" / "proxy-samples"
CHECK_SCRIPT = REPO / "scripts" / "check-headers.sh"

BASE_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def vercel_rules() -> list[dict]:
    return json.loads(VERCEL_JSON.read_text(encoding="utf-8"))["headers"]


def header_map(rule: dict) -> dict[str, str]:
    return {item["key"]: item["value"] for item in rule["headers"]}


def rule_for(source: str) -> dict:
    return next(rule for rule in vercel_rules() if rule["source"] == source)


# --- The API (AC-M6-17: /api) ------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/health",  # a normal answer
        "/api/v1/does-not-exist",  # a 404
        "/api/v1/auth/me",  # a refusal (not signed in)
    ],
)
def test_every_api_answer_has_the_security_headers_and_no_store(
    client: TestClient, path: str
) -> None:
    response = client.get(path)

    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "max-age=" in response.headers["Strict-Transport-Security"]
    assert "camera=(self)" in response.headers["Permissions-Policy"]
    assert response.headers["Referrer-Policy"]


# --- frontend/vercel.json (AC-M6-17: /admin, /attendance, /phone) -----------------------


def test_vercel_json_is_valid_and_every_header_rule_carries_the_base_headers() -> None:
    for rule in vercel_rules():
        headers = header_map(rule)
        for name, start in BASE_HEADERS.items():
            assert headers.get(name, "").startswith(start), (rule["source"], name)


def test_the_catch_all_rule_comes_before_the_phone_and_gate_rules() -> None:
    """Vercel applies matching rules in order and the last value wins, so a catch-all that came
    after them would overwrite their Content-Security-Policy."""
    sources = [rule["source"] for rule in vercel_rules()]
    catch_all = sources.index("/(.*)")
    for later in ("/phone", "/phone/:path*", "/attendance", "/attendance/:path*"):
        assert sources.index(later) > catch_all, later


def required_directives(csp: str) -> dict[str, str]:
    return {part.split(" ", 1)[0]: part for part in (p.strip() for p in csp.split(";")) if part}


@pytest.mark.parametrize("source", ["/phone", "/phone/:path*", "/attendance", "/attendance/:path*"])
def test_phone_and_gate_pages_carry_a_strict_csp(source: str) -> None:
    csp = header_map(rule_for(source))["Content-Security-Policy"]
    directives = required_directives(csp)

    assert directives["default-src"] == "default-src 'self'"
    assert directives["frame-ancestors"] == "frame-ancestors 'none'"
    assert directives["object-src"] == "object-src 'none'"
    assert directives["base-uri"] == "base-uri 'self'"
    assert directives["connect-src"] == "connect-src 'self'"
    # The gate needs the service worker, camera pictures as blobs and the QR decoder (wasm).
    assert "'self' blob:" in directives["worker-src"]
    assert "blob:" in directives["img-src"]
    assert "'wasm-unsafe-eval'" in directives["script-src"]
    # No way to run injected script.
    assert "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
    assert "'unsafe-inline'" not in directives["script-src"]
    assert " * " not in f" {csp} " and "http:" not in csp


def test_the_phone_rule_allows_passkeys_and_the_gate_rule_does_not() -> None:
    assert (
        "publickey-credentials-get=(self)" in header_map(rule_for("/phone"))["Permissions-Policy"]
    )
    assert "publickey-credentials" not in header_map(rule_for("/attendance"))["Permissions-Policy"]


def test_the_gate_service_worker_and_the_api_rules_exist() -> None:
    assert header_map(rule_for("/sw.js"))["Service-Worker-Allowed"] == "/attendance"
    assert header_map(rule_for("/api/:path*"))["Cache-Control"] == "no-store"


def test_the_admin_pages_keep_the_base_headers_without_a_csp() -> None:
    """S-63 (admin CSP) was not approved: the catch-all has no CSP on purpose (decision 0038)."""
    assert "Content-Security-Policy" not in header_map(rule_for("/(.*)"))


# --- The proxy samples must say the same as vercel.json -------------------------------------


@pytest.mark.parametrize("sample", ["nginx.conf", "Caddyfile"])
def test_proxy_samples_set_the_same_headers_as_vercel_json(sample: str) -> None:
    text = (PROXY_SAMPLES / sample).read_text(encoding="utf-8")
    gate_csp = header_map(rule_for("/attendance"))["Content-Security-Policy"]
    phone_permissions = header_map(rule_for("/phone"))["Permissions-Policy"]

    assert gate_csp in text
    assert phone_permissions in text
    for name in (*BASE_HEADERS, "Referrer-Policy", "Permissions-Policy", "Cache-Control"):
        assert name in text, name
    assert "no-store" in text and "Service-Worker-Allowed" in text
    # The proxy overwrites the caller's X-Forwarded-For; appending would let a caller forge it.
    assert "$proxy_add_x_forwarded_for" not in text


def test_the_samples_overwrite_x_forwarded_for() -> None:
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in (
        PROXY_SAMPLES / "nginx.conf"
    ).read_text(encoding="utf-8")
    assert re.search(
        r"header_up X-Forwarded-For \{remote_host\}",
        (PROXY_SAMPLES / "Caddyfile").read_text(encoding="utf-8"),
    )


# --- scripts/check-headers.sh refuses other people's servers -----------------------------------


def working_bash() -> str | None:
    """A bash that runs (on Windows `bash` may be the WSL stub, which does not work here)."""
    candidates = [shutil.which("bash"), r"C:\Program Files\Git\bin\bash.exe", "/bin/bash"]
    for candidate in candidates:
        if candidate is None or not Path(candidate).exists():
            continue
        probe = subprocess.run(  # noqa: S603 - a fixed path and a fixed command
            [candidate, "-c", "echo ok"], capture_output=True, text=True, timeout=30
        )
        if probe.stdout.strip() == "ok":
            return candidate
    return None


@pytest.mark.skipif(working_bash() is None, reason="no working bash on this computer")
@pytest.mark.parametrize(
    "target",
    ["https://example.com", "http://localhost.evil.example", "http://localhost@evil.example/"],
)
def test_the_header_check_script_refuses_a_target_that_is_not_this_computer(target: str) -> None:
    bash = working_bash()
    assert bash is not None
    result = subprocess.run(  # noqa: S603 - our own script with a fixed test address
        [bash, str(CHECK_SCRIPT), target], capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 2
    assert "Refused" in result.stderr
