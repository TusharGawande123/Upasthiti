# Backend image. Render builds and runs this file (M1); any Linux server can run it too.
# Build:  docker build -t upasthiti-backend backend
# Run:    docker run -p 8000:8000 -e DATABASE_URL=... upasthiti-backend

FROM python:3.12-slim

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

# Never run the server as root.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

# Render sets PORT; 8000 is the default everywhere else.
EXPOSE 8000
CMD ["sh", "-c", "fastapi run app/main.py --host 0.0.0.0 --port ${PORT:-8000}"]
