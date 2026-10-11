# Upasthiti backend

FastAPI app (Python 3.12, managed by uv). Folder guide: docs/architecture.md §8.
Setup and commands: the root README.md.

- `app/core/`: settings, database, error format, logging, time helpers (shared by every module).
- `app/modules/<name>/`: one feature module each (`health` is the first).
- `migrations/`: Alembic; new files are numbered (`0002_...`), see `alembic.ini`.
- `tests/`: pytest. Tests never reach a real database unless they say so.
