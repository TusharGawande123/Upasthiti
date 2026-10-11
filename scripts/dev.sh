#!/usr/bin/env bash
# Starts the backend and the frontend together for local development (Git Bash, Linux, macOS).
# Run from anywhere:  ./scripts/dev.sh      Stop both with Ctrl+C.
# Needs: uv, Node 24, and a database (docker compose up -d, or a native PostgreSQL).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. See README.md, 'First-time setup'." >&2
  exit 1
fi
if [ ! -d "$repo_root/frontend/node_modules" ]; then
  echo "Installing frontend packages (first run only)..."
  npm --prefix "$repo_root/frontend" install
fi

# Stop the backend when this script stops.
cleanup() { kill "$backend_pid" 2>/dev/null || true; }
trap cleanup EXIT

(cd "$repo_root/backend" && uv run fastapi dev app/main.py) &
backend_pid=$!

echo "Backend:  http://localhost:8000/api/docs"
echo "Frontend: http://localhost:5173/admin"
cd "$repo_root/frontend"
npm run dev
