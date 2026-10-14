#!/bin/sh
# Starts the backend inside the container (Render and any Linux server).
# Render's free plan has no "pre-deploy" step, so with RUN_MIGRATIONS_ON_START=true the
# database is migrated here first. Alembic takes a lock, so this is safe to repeat.
set -e

# /api/v1/health shows this version. Render provides the git commit; elsewhere set
# APP_VERSION yourself (or it stays "dev").
export APP_VERSION="${APP_VERSION:-${RENDER_GIT_COMMIT:-dev}}"

case "$RUN_MIGRATIONS_ON_START" in
  true | TRUE | True | 1)
    echo "Running database migrations..."
    alembic upgrade head
    ;;
esac

# exec: the server replaces this shell, so it receives Render's stop signal directly.
# uvicorn directly (not `fastapi run`, which cannot switch the access log off): its access log
# lines contain the query string (pairing code, search words). The app writes its own request
# log with the path only.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log
