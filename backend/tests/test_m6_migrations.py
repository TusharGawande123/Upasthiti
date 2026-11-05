"""M6 S-62 (plan 5.4): the migrations as a whole.

Runs in its own database (name ends in "_m6_test"), because the shared test database is always at
the latest migration and is rolled back by every test. Proves: an empty database upgrades to head;
`alembic check` finds no difference between the models and the migrations; the last migration (0034)
goes down and up again; and every table in the database is named in the table dictionary of
docs/architecture.md (section 7). The rule "every table has RLS and a deny_all policy" has its own
guard in test_row_level_security, so it is not repeated here."""

import re
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

ARCHITECTURE_FILE = BACKEND_FOLDER.parent / "docs" / "architecture.md"
LAST_MIGRATION = "0034"
MIGRATION_BEFORE_LAST = "0033"
# Tables the dictionary still lists although they were never built (the salary estimate was
# cancelled by the client on 2026-11-04; the phone tables of M4b have other names).
DICTIONARY_ONLY_TABLES = {
    "salary_components",
    "salary_structures",
    "salary_structure_lines",
    "salary_runs",
    "salary_estimates",
    "manual_deductions",
    "employee_phones",  # M4b built the `phone_*` tables instead
}
# Tables built in M4b to M6 that the dictionary does not list yet (found by this test on
# 2026-11-05). The docs stream adds them; then each name must be removed from this set (the test
# below fails for a name that is documented, so the list can only shrink).
NOT_YET_DOCUMENTED_TABLES = {
    "data_request_events",
    "employee_type_history",
    "holiday_plants",
    "notification_deliveries",
    "notification_reads",
    "notifications",
    "phone_access",
    "phone_accounts",
    "phone_notice_acceptances",
    "phone_passkeys",
    "phone_proofs",
    "phone_sessions",
    "plant_weekly_offs",
    "regularisation_decisions",
    "shift_rule_versions",
    "shift_swaps",
}


def alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_FOLDER / "migrations"))
    config.attributes["database_url"] = url
    return config


@pytest.fixture(scope="module")
def scratch_database() -> Iterator[tuple[Engine, Config]]:
    """An empty database, upgraded to head once for all tests of this file."""
    shared_url = read_test_database_url()
    if not shared_url:
        pytest.skip("TEST_DATABASE_URL is not set.")
    shared_name = make_url(shared_url).database or ""
    name = shared_name.removesuffix("_test") + "_m6_test"
    url = make_url(shared_url).set(database=name).render_as_string(hide_password=False)
    _create_database_if_missing(url, name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    config = alembic_config(url)
    command.upgrade(config, "head")
    yield engine, config
    engine.dispose()


def current_revision(engine: Engine) -> str:
    with engine.connect() as connection:
        return str(connection.execute(text("SELECT version_num FROM alembic_version")).scalar())


def table_names(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names()) - {"alembic_version"}


def test_a_fresh_upgrade_reaches_the_last_migration_with_tables(
    scratch_database: tuple[Engine, Config],
) -> None:
    """M6 S-62: upgrade from an empty database."""
    engine, _config = scratch_database

    assert current_revision(engine).startswith(LAST_MIGRATION)
    assert len(table_names(engine)) > 40


def test_alembic_check_finds_no_difference_between_models_and_migrations(
    scratch_database: tuple[Engine, Config],
) -> None:
    """M6 S-62: a model change without its migration fails here (command.check raises)."""
    _engine, config = scratch_database

    command.check(config)


def test_the_last_migration_goes_down_and_up_again(
    scratch_database: tuple[Engine, Config],
) -> None:
    """M6 S-62: 0034 down then up, and the tables come back the same."""
    engine, config = scratch_database
    tables_at_head = table_names(engine)

    command.downgrade(config, MIGRATION_BEFORE_LAST)
    assert current_revision(engine).startswith(MIGRATION_BEFORE_LAST)
    assert "data_requests" not in table_names(engine)
    command.upgrade(config, "head")

    assert current_revision(engine).startswith(LAST_MIGRATION)
    assert table_names(engine) == tables_at_head
    command.check(config)


def tables_named_in_the_dictionary() -> set[str]:
    """Every first `name` of a row of the section 7 table, e.g. "| | `shifts` | ..."."""
    text_of_file = ARCHITECTURE_FILE.read_text(encoding="utf-8")
    section = text_of_file.split("## 7. Data model", 1)[1].split("\n## 8.", 1)[0]
    names: set[str] = set()
    for line in section.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        found = re.match(r"^`([a-z_]+)`", cells[1])
        if found:
            names.add(found.group(1))
    return names


def test_every_table_is_named_in_the_architecture_table_dictionary(
    scratch_database: tuple[Engine, Config],
) -> None:
    """M6 S-62: the dictionary in docs/architecture.md matches the real database."""
    engine, _config = scratch_database
    documented = tables_named_in_the_dictionary()

    missing_in_docs = table_names(engine) - documented - NOT_YET_DOCUMENTED_TABLES
    listed_but_not_built = documented - table_names(engine) - DICTIONARY_ONLY_TABLES

    assert not missing_in_docs, (
        f"tables missing from docs/architecture.md: {sorted(missing_in_docs)}"
    )
    assert not listed_but_not_built, f"listed but not built: {sorted(listed_but_not_built)}"
    now_documented = NOT_YET_DOCUMENTED_TABLES & documented
    assert not now_documented, f"remove from NOT_YET_DOCUMENTED_TABLES: {sorted(now_documented)}"
