# Backend image. Render builds and runs this file (M1); any Linux server can run it too.
# Build:  docker build -t upasthiti-backend backend
# Run:    docker run -p 8000:8000 -e DATABASE_URL=... upasthiti-backend

FROM python:3.14-slim

# uv installs the exact package versions from uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Install packages first, in their own layer, so code changes don't reinstall everything.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project

COPY . .

# Never run the server as root. The code stays owned by root, so the server cannot change
# its own files; folders it must write to (e.g. a model cache in M3) get their own chown.
RUN useradd --create-home --uid 10001 app
USER app

# Render sets PORT; 8000 is the default everywhere else.
EXPOSE 8000
# Migrates first when RUN_MIGRATIONS_ON_START=true (Render), then starts the server.
CMD ["sh", "scripts/start.sh"]
