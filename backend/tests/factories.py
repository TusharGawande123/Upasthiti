"""Small helpers that create test data. All data is fake (the repository is public)."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.auth.passwords import hash_password
from app.modules.users.models import Role, User

TEST_PASSWORD = "Correct-Horse-42"


def make_user(
    session: Session,
    role: Role = Role.SUPER_ADMIN,
    *,
    username: str | None = None,
    email: str | None = None,
    password: str = TEST_PASSWORD,
    must_change_password: bool = False,
    is_active: bool = True,
) -> User:
    user = User(
        name=f"Test {role.value}",
        username=username or f"user{uuid.uuid4().hex[:8]}",
        email=email,
        password_hash=hash_password(password),
        role=role.value,
        must_change_password=must_change_password,
        is_active=is_active,
    )
    session.add(user)
    session.commit()
    return user


def log_in(client: TestClient, login: str, password: str = TEST_PASSWORD) -> None:
    """Log the test client in; its cookie jar keeps the session cookie."""
    response = client.post("/api/v1/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200, response.text
