"""Migration 0033: no overtime rate for permanent employees (M5c, 2026-11-04).

Runs in its own database (name ends in "_m0033_test"), because the shared test database is always
at the latest migration.
"""

import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, make_url, text

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
def database_at_0032() -> Iterator[tuple[Engine, Config]]:
    shared_url = read_test_database_url()
    if not shared_url:
        pytest.skip("TEST_DATABASE_URL is not set.")
    shared_name = make_url(shared_url).database or ""
    name = shared_name.removesuffix("_test") + "_m0033_test"
    url = make_url(shared_url).set(database=name).render_as_string(hide_password=False)
    _create_database_if_missing(url, name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = _alembic_config(url)
    command.upgrade(config, "0032")
    yield engine, config
    engine.dispose()


def _employee(
    connection, plant_id, category_id, code: str, kind: str, rate: str | None
) -> uuid.UUID:  # noqa: ANN001
    employee_id = uuid.uuid4()
    connection.execute(
        text(
            "INSERT INTO employees (id, employee_code, full_name, type, plant_id, category_id, "
            "punch_method, hourly_rate, ot_rate_per_hour, status, joined_on, created_at, "
            "updated_at) VALUES (:id, :code, :code, :kind, :plant, :category, :method, :hourly, "
            ":rate, 'active', '2026-01-01', now(), now())"
        ),
        {
            "id": employee_id,
            "code": code,
            "kind": kind,
            "plant": plant_id,
            "category": category_id,
            "method": "face" if kind == "permanent" else "qr",
            "hourly": "85.00" if kind == "temporary" else None,
            "rate": rate,
        },
    )
    return employee_id


def test_migration_0033_clears_permanent_rates_keeps_temporary_ones_and_audits_the_old_values(
    database_at_0032: tuple[Engine, Config],
) -> None:
    engine, config = database_at_0032
    plant_id, category_id = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO plants (id, name, code, address, is_active, created_at, updated_at) "
                "VALUES (:id, 'Plant', 'K134', '', true, now(), now())"
            ),
            {"id": plant_id},
        )
        connection.execute(
            text(
                "INSERT INTO employee_categories (id, plant_id, name, is_active, created_at, "
                "updated_at) VALUES (:id, :plant, 'Staff', true, now(), now())"
            ),
            {"id": category_id, "plant": plant_id},
        )
        permanent = _employee(connection, plant_id, category_id, "P-1", "permanent", "150.00")
        temporary = _employee(connection, plant_id, category_id, "T-1", "temporary", "90.00")

    command.upgrade(config, "0033")

    with engine.connect() as connection:
        rates = dict(connection.execute(text("SELECT id, ot_rate_per_hour FROM employees")).all())
        audit = connection.execute(
            text("SELECT before, after FROM audit_logs WHERE action = 'employee.ot_rate_cleared'")
        ).all()
    assert rates[permanent] is None
    assert str(rates[temporary]) == "90.00"  # a temporary worker keeps the rate
    assert len(audit) == 1  # one audit row with the old values, nothing is lost
    assert audit[0].after == {"employees_cleared": 1}
    assert audit[0].before["rates"] == [{"employee_id": str(permanent), "ot_rate_per_hour": 150.0}]

    # The database now refuses a permanent employee with a rate.
    with pytest.raises(Exception, match="permanent_has_no_ot_rate"), engine.begin() as connection:
        connection.execute(
            text("UPDATE employees SET ot_rate_per_hour = 10 WHERE id = :id"), {"id": permanent}
        )
    command.downgrade(config, "0032")
    with engine.begin() as connection:  # the check is gone again after a rollback
        connection.execute(
            text("UPDATE employees SET ot_rate_per_hour = 10 WHERE id = :id"), {"id": permanent}
        )


def test_migration_0033_writes_no_audit_row_when_nobody_had_a_rate(
    database_at_0032: tuple[Engine, Config],
) -> None:
    engine, config = database_at_0032

    command.upgrade(config, "0033")

    with engine.connect() as connection:
        count = connection.execute(
            text("SELECT count(*) FROM audit_logs WHERE action = 'employee.ot_rate_cleared'")
        ).scalar_one()
    assert count == 0
