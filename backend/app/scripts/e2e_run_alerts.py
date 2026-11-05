"""Runs the 5-minute alert job once at a chosen moment, for the end-to-end journeys only:

    APP_ENV=test uv run python -m app.scripts.e2e_run_alerts 2026-11-06T20:30:00+05:30

The scheduler is off in the end-to-end run (RUN_SCHEDULER=false) and the alerts depend on the
clock ("still inside" waits for an hour after the shift end), so a journey cannot wait for them.
This runs the same job function the scheduler runs (`run_five_minute_alerts`), with a "now" the
journey chooses. It refuses to run unless APP_ENV=test and the database is a local one whose
name ends in "_e2e". DEMO plants still never raise alerts.
"""

import os
import sys
from datetime import datetime

from sqlalchemy.engine import make_url

from app.core.db import get_session_factory
from app.modules.notifications.alerts import run_five_minute_alerts
from app.scripts.e2e_seed import E2E_DATABASE_NAME_ENDING, LOCAL_HOSTS


def main() -> None:
    if os.environ.get("APP_ENV") != "test":
        sys.exit("Refused: this tool runs only with APP_ENV=test.")
    # The same guard as e2e_seed: only the local throw-away end-to-end database.
    database_url = make_url(os.environ.get("DATABASE_URL", ""))
    if not (database_url.database or "").endswith(E2E_DATABASE_NAME_ENDING):
        sys.exit("Refused: the database name must end in _e2e.")
    if (database_url.host or "localhost") not in LOCAL_HOSTS:
        sys.exit("Refused: the end-to-end database must be on this computer.")
    if len(sys.argv) != 2:
        sys.exit("Usage: python -m app.scripts.e2e_run_alerts <ISO moment with time zone>")
    moment = datetime.fromisoformat(sys.argv[1])
    if moment.tzinfo is None:
        sys.exit("The moment needs a time zone, for example 2026-11-06T20:30:00+05:30.")
    with get_session_factory()() as session:
        run_five_minute_alerts(session, moment)
    print("alerts checked")


if __name__ == "__main__":
    main()
