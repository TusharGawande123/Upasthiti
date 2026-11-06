# Backend image. Render builds and runs this file (M1); any Linux server can run it too.
# Build:  docker build -t upasthiti-backend backend
# Run:    docker run -p 8000:8000 -e DATABASE_URL=... upasthiti-backend

# Stage 1: the face models (M3). They are downloaded here, sha256 checked, and (for the INT8
# measurement of slice 1) quantised. Only the finished files are copied into the final image, so
# the `onnx` package needed for quantising never ships and no model file ever enters git.
FROM python:3.14-slim AS face-models

COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/models-venv

WORKDIR /build
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project \
    && uv pip install --python /opt/models-venv/bin/python onnx
COPY scripts/models.json scripts/download_models.py scripts/quantise_models.py scripts/

# Which downloads to bake in (names from scripts/models.json) and whether to make INT8 copies.
ARG FACE_MODEL_DOWNLOADS=buffalo_l,buffalo_s,minifasnet_v2,minifasnet_v1se,sample_faces
ARG MAKE_INT8_MODELS=true
RUN /opt/models-venv/bin/python scripts/download_models.py --dest /models \
        --only "$FACE_MODEL_DOWNLOADS" \
    && if [ "$MAKE_INT8_MODELS" = "true" ]; then \
         /opt/models-venv/bin/python scripts/quantise_models.py --dest /models; \
       fi

# Stage 2: the app.
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

# The face models from stage 1: read-only for the server (root owns them).
COPY --from=face-models /models /app/models
ENV FACE_MODELS_DIR=/app/models

# Own server only (deploy/prod): the backup command needs pg_dump and pg_restore. Render never sets
# this, so its image stays as small as before. Debian 13 carries PostgreSQL 17 client tools.
ARG INSTALL_PG_TOOLS=false
RUN if [ "$INSTALL_PG_TOOLS" = "true" ]; then       apt-get update       && apt-get install -y --no-install-recommends postgresql-client       && rm -rf /var/lib/apt/lists/*;     fi

# Never run the server as root. The code stays owned by root, so the server cannot change
# its own files; folders it must write to (e.g. a model cache in M3) get their own chown.
RUN useradd --create-home --uid 10001 app
# Folders the server may write to on an own server: punch photos and backups (deploy/prod mounts
# volumes here; a volume copies this ownership the first time it is created).
RUN mkdir -p /data/snapshots /backups && chown app:app /data/snapshots /backups
USER app

# Render sets PORT; 8000 is the default everywhere else.
EXPOSE 8000
# Migrates first when RUN_MIGRATIONS_ON_START=true (Render), then starts the server.
CMD ["sh", "scripts/start.sh"]
