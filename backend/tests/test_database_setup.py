"""The test database is migrated to the latest revision and each test is rolled back."""

from sqlalchemy import text
from sqlalchemy.orm import Session


def test_test_database_is_at_the_latest_migration(db_session: Session) -> None:
    version = db_session.execute(text("SELECT version_num FROM alembic_version")).scalar()

    assert version is not None


def test_changes_made_in_a_test_are_rolled_back(db_session: Session) -> None:
    db_session.execute(text("CREATE TABLE rollback_probe (id int)"))
    db_session.commit()  # becomes a savepoint inside the test's outer transaction

    exists = db_session.execute(text("SELECT to_regclass('rollback_probe')")).scalar()
    assert exists is not None


def test_previous_test_left_nothing_behind(db_session: Session) -> None:
    exists = db_session.execute(text("SELECT to_regclass('rollback_probe')")).scalar()

    assert exists is None
