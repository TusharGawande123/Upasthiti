"""Migration 0019 on a database that still has the M1 shift columns (M5 spec AC-24).

Runs in its own database (name ends in "_m0019_test"), because the shared test database is
always at the latest migration.
"""

import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, make_url, text

from tests.database import (
    BACKEND_FOLDER,
    CONNECT_ARGS,
    _create_database_if_missing,
    read_test_database_url,
)


def _alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_FOLDER / "migrations"))
    config.attributes["database_url"] = url
    return config


@pytest.fixture
def database_at_0018() -> Iterator[tuple[Engine, Config]]:
    shared_url = read_test_database_url()
    if not shared_url:
        pytest.skip("TEST_DATABASE_URL is not set.")
    shared_name = make_url(shared_url).database or ""
    name = shared_name.removesuffix("_test") + "_m0019_test"
    url = make_url(shared_url).set(database=name).render_as_string(hide_password=False)
    _create_database_if_missing(url, name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = _alembic_config(url)
    command.upgrade(config, "0018")
    yield engine, config
    engine.dispose()


def test_migration_0019_moves_shifts_to_the_new_rules(database_at_0018: tuple[Engine, Config]):
    engine, config = database_at_0018
    plant_id, shift_id = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO plants (id, name, code, address, is_active, created_at, updated_at) "
                "VALUES (:id, 'Plant', 'K134', '', true, "
                "'2026-10-20 20:00:00+00', '2026-10-20 20:00:00+00')"
            ),
            {"id": plant_id},
        )
        connection.execute(
            text(
                "INSERT INTO shifts (id, plant_id, name, start_time, end_time, crosses_midnight, "
                "grace_min, half_day_min, ot_after_min, is_active, created_at, updated_at) "
                "VALUES (:id, :plant, 'General', '07:00', '19:00', false, 10, 240, 480, true, "
                "'2026-10-20 20:00:00+00', '2026-10-20 20:00:00+00')"
            ),
            {"id": shift_id, "plant": plant_id},
        )

    command.upgrade(config, "0019")

    with engine.connect() as connection:
        shift = connection.execute(
            text("SELECT grace_min, half_day_min, overtime_min_minutes FROM shifts")
        ).one()
        versions = connection.execute(
            text(
                "SELECT effective_from::text, grace_min, overtime_min_minutes, created_by "
                "FROM shift_rule_versions"
            )
        ).all()
        weekly_offs = connection.execute(
            text("SELECT weekday, effective_from::text FROM plant_weekly_offs")
        ).all()
        audit = connection.execute(
            text("SELECT before, after FROM audit_logs WHERE action = 'shift.rules_migrated'")
        ).all()
    columns = {column["name"] for column in inspect(engine).get_columns("shifts")}

    assert tuple(shift) == (30, 240, 120)
    assert "ot_after_min" not in columns
    assert "full_day_min" not in columns
    # 20:00 UTC on 20/10 is 01:30 IST on 21/10: dates are IST dates.
    assert [tuple(row) for row in versions] == [("2026-10-21", 30, 120, None)]
    assert [tuple(row) for row in weekly_offs] == [(7, "2026-10-21")]
    assert len(audit) == 1
    assert audit[0].before == {"grace_min": 10, "ot_after_min": 480}
    assert audit[0].after == {
        "grace_min": 30,
        "ot_after_min": "removed (0)",
        "overtime_min_minutes": 120,
    }

    # And back: the old column returns, so a rollback of the deploy is possible.
    command.downgrade(config, "0018")
    columns = {column["name"] for column in inspect(engine).get_columns("shifts")}
    assert "ot_after_min" in columns
    assert "overtime_min_minutes" not in columns
