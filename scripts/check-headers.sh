#!/usr/bin/env bash
# Checks the security headers of a RUNNING Upasthiti site with curl (M6, spec 7.5 rule 5).
# Usage: ./scripts/check-headers.sh [base-url]      default: http://localhost:8080
# It only talks to this computer (localhost, 127.0.0.1, ::1): a scan of somebody else's server is
# refused. To check a real site after a proxy change, run the script ON that server.
set -u

base_url="${1:-http://localhost:8080}"
base_url="${base_url%/}"

# Refuse anything that is not this computer.
host_part="${base_url#*://}"
host_part="${host_part%%/*}"
host_name="${host_part%%:*}"
case "$host_part" in
  "["*) host_name="${host_part%%]*}]" ;;
esac
case "$host_name" in
  localhost | 127.0.0.1 | "[::1]" | *.localhost) ;;
  *)
    echo "Refused: $host_name is not this computer. This script checks local targets only." >&2
    exit 2
    ;;
esac

failures=0

header_value() {
  # $1 = headers text, $2 = header name; prints the value (empty when missing)
  printf '%s\n' "$1" | tr -d '\r' | grep -i "^$2:" | head -n 1 | cut -d: -f2- | sed 's/^ *//'
}

expect_header() {
  # $1 = path, $2 = headers text, $3 = name, $4 = text the value must contain (may be empty)
  local value
  value="$(header_value "$2" "$3")"
  if [ -z "$value" ]; then
    echo "FAIL  $1  missing header $3"
    failures=$((failures + 1))
  elif [ -n "$4" ] && [[ "$value" != *"$4"* ]]; then
    echo "FAIL  $1  $3 does not contain: $4"
    failures=$((failures + 1))
  else
    echo "ok    $1  $3"
  fi
}

check_path() {
  # $1 = path, $2 = "csp" when a strict CSP is required, $3 = "nostore" when no-store is required
  local path="$1" headers
  headers="$(curl -s -o /dev/null -D - --max-time 15 "$base_url$path")" || {
    echo "FAIL  $path  no answer from $base_url"
    failures=$((failures + 1))
    return
  }
  expect_header "$path" "$headers" "X-Content-Type-Options" "nosniff"
  expect_header "$path" "$headers" "X-Frame-Options" "DENY"
  expect_header "$path" "$headers" "Referrer-Policy" ""
  expect_header "$path" "$headers" "Permissions-Policy" "camera=(self)"
  # HSTS is only meaningful (and only sent) over HTTPS; a plain local http address may not have it.
  if [[ "$base_url" == https://* ]]; then
    expect_header "$path" "$headers" "Strict-Transport-Security" "max-age="
  fi
  if [ "${2:-}" = "csp" ]; then
    expect_header "$path" "$headers" "Content-Security-Policy" "frame-ancestors 'none'"
    expect_header "$path" "$headers" "Content-Security-Policy" "object-src 'none'"
  fi
  if [ "${3:-}" = "nostore" ]; then
    expect_header "$path" "$headers" "Cache-Control" "no-store"
  fi
}

check_path "/admin/login"
check_path "/attendance" csp
check_path "/phone" csp
check_path "/phone/login" csp
check_path "/api/v1/health" "" nostore

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All header checks passed for $base_url"
