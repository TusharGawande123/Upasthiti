"""Migrations 0026 and 0027 (M4b phone punching) on a database that already has gate punches.

Runs in its own database (name ends in "_m4b_test"), because the shared test database is always at
the latest migration. Proves: an old gate punch becomes a "kiosk" punch with no matched plant and
still cannot be changed; the phone rules hold right after the upgrade; and the way back works
while no phone punch exists.
"""

import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, make_url, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.database import (
    BACKEND_FOLDER,
    CONNECT_ARGS,
    _create_database_if_missing,
    read_test_database_url,
)

PLANT_ID, KIOSK_ID, PUNCH_ID = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
PHONE_TABLES = {
    "phone_access",
    "phone_accounts",
    "phone_sessions",
    "phone_notice_acceptances",
    "phone_passkeys",
    "phone_proofs",
}


def _alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_FOLDER / "migrations"))
    config.attributes["database_url"] = url
    return config


@pytest.fixture
def database_at_0025() -> Iterator[tuple[Engine, Config]]:
    shared_url = read_test_database_url()
    if not shared_url:
        pytest.skip("TEST_DATABASE_URL is not set.")
    shared_name = make_url(shared_url).database or ""
    name = shared_name.removesuffix("_test") + "_m4b_test"
    url = make_url(shared_url).set(database=name).render_as_string(hide_password=False)
    _create_database_if_missing(url, name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = _alembic_config(url)
    command.upgrade(config, "0025")
    yield engine, config
    engine.dispose()


def _add_a_gate_punch(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO plants (id, name, code, address, is_active, created_at, updated_at) "
                "VALUES (:id, 'Plant', 'K134', '', true, now(), now())"
            ),
            {"id": PLANT_ID},
        )
        connection.execute(
            text(
                "INSERT INTO kiosk_devices (id, plant_id, name, status, last_counter, created_at, "
                "updated_at) VALUES (:id, :plant, 'Main gate', 'active', 0, now(), now())"
            ),
            {"id": KIOSK_ID, "plant": PLANT_ID},
        )
        connection.execute(
            text(
                "INSERT INTO punches (id, client_punch_id, kiosk_id, plant_id, method, direction, "
                "decision, reason_codes, server_received_at) VALUES (:id, :client, :kiosk, "
                ":plant, 'qr', NULL, 'rejected', '{QR_EXPIRED}', now())"
            ),
            {"id": PUNCH_ID, "client": uuid.uuid4(), "kiosk": KIOSK_ID, "plant": PLANT_ID},
        )


def test_old_gate_punches_become_kiosk_punches_and_the_way_back_works(
    database_at_0025: tuple[Engine, Config],
) -> None:
    engine, config = database_at_0025
    _add_a_gate_punch(engine)

    command.upgrade(config, "0027")

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT channel, phone_session_id, location_plant_id, kiosk_id FROM punches "
                "WHERE id = :id"
            ),
            {"id": PUNCH_ID},
        ).one()
    assert tuple(row) == ("kiosk", None, None, KIOSK_ID)
    assert set(inspect(engine).get_table_names()) >= PHONE_TABLES

    # Still append-only, and a gate punch without its device is refused at once.
    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as connection:
        connection.execute(
            text("UPDATE punches SET channel = 'phone' WHERE id = :id"), {"id": PUNCH_ID}
        )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO punches (id, client_punch_id, plant_id, method, direction, decision, "
                "reason_codes, server_received_at) VALUES (gen_random_uuid(), gen_random_uuid(), "
                ":plant, 'qr', 'in', 'accepted', '{}', now())"
            ),
            {"plant": PLANT_ID},
        )

    # And back: possible while no phone punch exists; the gate punch is still there.
    command.downgrade(config, "0025")
    assert not PHONE_TABLES & set(inspect(engine).get_table_names())
    columns = {column["name"] for column in inspect(engine).get_columns("punches")}
    assert not {"channel", "phone_session_id", "location_plant_id"} & columns
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM punches")).scalar() == 1

    command.upgrade(config, "head")
