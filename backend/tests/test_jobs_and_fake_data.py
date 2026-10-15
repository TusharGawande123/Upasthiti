"""The daily job and the fake-data command (spec S-15, AC-34, F-20)."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.jobs.daily import run_daily_jobs
from app.modules.auth.models import LoginSession
from app.modules.employees.models import Employee
from app.modules.users.models import Role
from app.scripts import make_fake_data as fake_data_script
from tests.factories import make_user


def test_daily_job_deletes_only_old_sessions(db_session: Session) -> None:
    user = make_user(db_session, Role.SUPER_ADMIN, username="boss")
    now = utc_now()
    for index, expires in enumerate((now - timedelta(days=40), now - timedelta(days=5), now)):
        db_session.add(
            LoginSession(
                user_id=user.id,
                token_hash=f"hash{index}".ljust(64, "0"),
                last_seen_at=now,
                expires_at=expires,
            )
        )
    db_session.commit()

    result = run_daily_jobs(db_session)

    assert result["sessions_deleted"] == 1
    assert db_session.scalar(select(func.count()).select_from(LoginSession)) == 2
    assert run_daily_jobs(db_session)["sessions_deleted"] == 0  # safe to repeat


def test_fake_data_makes_650_employees_across_7_plants(db_session: Session) -> None:
    counts = fake_data_script.make_fake_data(db_session)

    assert counts == {"plants": 7, "employees": 650}
    by_type = dict(
        db_session.execute(select(Employee.type, func.count()).group_by(Employee.type)).all()
    )
    assert by_type == {"permanent": 300, "temporary": 350}
    per_plant = (
        db_session.execute(select(func.count()).select_from(Employee).group_by(Employee.plant_id))
        .scalars()
        .all()
    )
    assert len(per_plant) == 7
    assert max(per_plant) - min(per_plant) <= 2


def test_fake_data_refuses_when_employees_exist(db_session: Session) -> None:
    fake_data_script.make_fake_data(db_session)

    with pytest.raises(SystemExit):
        fake_data_script.make_fake_data(db_session)


def test_fake_data_command_refuses_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_PUBLIC_ORIGIN", "https://example.invalid")

    assert fake_data_script.main() == 1
