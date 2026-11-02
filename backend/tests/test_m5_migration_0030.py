"""Migration 0030: the grace after the shift end (decision 0036 line 79).

Runs in its own database (name ends in "_m0030_test"), because the shared test database is
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
def database_at_0029() -> Iterator[tuple[Engine, Config]]:
    shared_url = read_test_database_url()
    if not shared_url:
        pytest.skip("TEST_DATABASE_URL is not set.")
    shared_name = make_url(shared_url).database or ""
    name = shared_name.removesuffix("_test") + "_m0030_test"
    url = make_url(shared_url).set(database=name).render_as_string(hide_password=False)
    _create_database_if_missing(url, name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = _alembic_config(url)
    command.upgrade(config, "0029")
    yield engine, config
    engine.dispose()


def test_migration_0030_gives_every_shift_and_rule_version_a_grace_of_30_and_audits_it(
    database_at_0029: tuple[Engine, Config],
) -> None:
    engine, config = database_at_0029
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
                "grace_min, half_day_min, overtime_min_minutes, is_active, created_at, updated_at) "
                "VALUES (:id, :plant, 'General', '07:00', '19:00', false, 15, 240, 120, true, "
                "'2026-10-20 20:00:00+00', '2026-10-20 20:00:00+00')"
            ),
            {"id": shift_id, "plant": plant_id},
        )
        connection.execute(
            text(
                "INSERT INTO shift_rule_versions (id, shift_id, effective_from, start_time, "
                "end_time, crosses_midnight, grace_min, half_day_min, overtime_min_minutes, "
                "created_by, created_at) VALUES (gen_random_uuid(), :shift, '2026-10-21', "
                "'07:00', '19:00', false, 15, 240, 120, NULL, now())"
            ),
            {"shift": shift_id},
        )

    command.upgrade(config, "0030")

    with engine.connect() as connection:
        shift = connection.execute(text("SELECT grace_min, grace_after_end_min FROM shifts")).one()
        version = connection.execute(
            text("SELECT grace_min, grace_after_end_min FROM shift_rule_versions")
        ).one()
        audit = connection.execute(
            text("SELECT before, after FROM audit_logs WHERE action = 'shift.rules_migrated'")
        ).all()
    assert tuple(shift) == (15, 30)  # the grace after the start is untouched
    assert tuple(version) == (15, 30)
    assert len(audit) == 1
    assert audit[0].before == {"grace_min": 15, "grace_after_end_min": "not available (0)"}
    assert audit[0].after == {"grace_min": 15, "grace_after_end_min": 30}

    # The range is enforced by the database, and the migration can be rolled back.
    with pytest.raises(Exception, match="grace_after_end_range"), engine.begin() as connection:
        connection.execute(text("UPDATE shifts SET grace_after_end_min = 121"))
    command.downgrade(config, "0029")
    columns = {column["name"] for column in inspect(engine).get_columns("shifts")}
    assert "grace_after_end_min" not in columns
