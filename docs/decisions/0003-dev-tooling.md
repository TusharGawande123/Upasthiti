# 0003 – Development tooling (M0)

Date: 2026-10-12 · Decided by: Tushar Gawande (project lead) · Status: Accepted
Spec: docs/specs/M0-setup.md · Plan: docs/plans/M0-setup-plan.md

## Decision
- **Python:** uv manages Python 3.12 and the backend packages (`backend/uv.lock`). Plain
  `python` on some laptops is 3.7, so always run Python through `uv run`.
- **Settings:** pydantic-settings reads environment variables (and `.env` locally). The app
  stops at start-up when a required variable is missing.
- **Time zones:** `zoneinfo` + the `tzdata` package (Windows has no system time-zone data).
- **Logging:** the standard library `logging` with a small JSON formatter and a request ID
  per request. No extra logging library.
- **Node:** Node 24 LTS (`.nvmrc`); npm with committed lockfiles.
- **Checks:** Ruff + pyright (backend), Biome + TypeScript 7 + our own translation-key script (frontend),
  Vitest, pytest and Playwright; coverage floor 60% in M0, raised each milestone.
- **CI jobs (all required on `main`):** `backend`, `frontend`, `e2e`, `docker`, `hooks`.
  Plus CodeQL and a PR-title check.
- **Hooks:** pre-commit with Ruff, Biome, gitleaks, private-key detection and a 1 MB file
  limit. CI runs the same hooks, so skipping them locally does not help.
- **Local database:** Postgres 17 through `docker-compose.yml`, or a native install.
- **Updates:** Dependabot weekly, minor/patch grouped.

## Why
One tool per job keeps the setup small enough for students to understand and for the client
to maintain after handover. Everything is free.
