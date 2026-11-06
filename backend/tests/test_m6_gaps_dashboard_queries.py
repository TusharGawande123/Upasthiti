"""M6 gap test for M5 AC-27: the live dashboard answers with a small, fixed number of database
queries, whatever the number of plants. Same 650 fake people and pinned clock as the speed test."""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.modules.org.models import Plant
from app.modules.users.models import Role
from tests.people_helpers import client_for
from tests.test_m6_gaps_dashboard_speed import company, pinned_clock  # noqa: F401

pytestmark = pytest.mark.time_sensitive

# One plant and seven plants may differ by a few queries (the busy first request recomputes
# open days), but never by one batch of queries per plant.
ALL_PLANTS_CEILING = 60
EXTRA_FOR_SIX_MORE_PLANTS = 8  # measured: 3


@contextmanager
def counting_queries(session: Session) -> Iterator[list[str]]:
    statements: list[str] = []
    engine = session.get_bind()

    def remember(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", remember)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", remember)


def test_the_live_answer_needs_few_queries_whatever_the_plant_count(
    db_app: FastAPI,
    company: Session,  # noqa: F811
) -> None:
    boss = client_for(db_app, company, Role.SUPER_ADMIN, "boss")
    one_plant = company.scalars(select(Plant).order_by(Plant.code)).first()
    assert one_plant is not None
    boss.get("/api/v1/dashboard/live")  # the first answer brings the stored days up to date

    with counting_queries(company) as one:
        assert boss.get("/api/v1/dashboard/live", params={"plant_id": str(one_plant.id)}).is_success
    with counting_queries(company) as every:
        assert boss.get("/api/v1/dashboard/live").is_success

    assert len(every) < ALL_PLANTS_CEILING, f"{len(every)} queries for all plants"
    assert len(every) - len(one) <= EXTRA_FOR_SIX_MORE_PLANTS, (len(one), len(every))
