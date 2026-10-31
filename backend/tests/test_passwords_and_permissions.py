"""Password rules and the role matrix (spec §7 rules 1 and 2)."""

import pytest

from app.core.errors import ApiError
from app.modules.auth.passwords import (
    TEMPORARY_PASSWORD_LENGTH,
    check_password_rules,
    generate_temporary_password,
    hash_password,
    verify_password,
)
from app.modules.auth.permissions import PERMISSIONS, Access, Capability, access_for
from app.modules.users.models import Role


def test_hash_and_verify() -> None:
    password_hash = hash_password("A-Good-Password-1")

    assert password_hash.startswith("$argon2id$")
    assert verify_password(password_hash, "A-Good-Password-1")
    assert not verify_password(password_hash, "wrong")
    assert not verify_password("not-a-hash", "anything")


@pytest.mark.parametrize(
    ("password", "rule"),
    [
        ("Short-1", "min_length"),
        ("12345678901", "not_only_digits"),
        ("sachin.kumar", "not_login_name"),
        ("s.kumar@example.com", "not_login_name"),
        ("Welcome@123", "too_common"),
    ],
)
def test_password_rules(password: str, rule: str) -> None:
    with pytest.raises(ApiError) as refused:
        check_password_rules(password, "sachin.kumar", "s.kumar@example.com")

    assert refused.value.details["rule"] == rule


def test_good_password_passes() -> None:
    check_password_rules("Gate-Kiosk-2026!", "sachin.kumar", None)


def test_temporary_passwords_are_long_and_different() -> None:
    first, second = generate_temporary_password(), generate_temporary_password()

    assert len(first) == TEMPORARY_PASSWORD_LENGTH
    assert first != second


def test_super_admin_can_do_everything_except_own_requests_view() -> None:
    # The Super Admin never asks: employee changes and corrections are made directly (M5 §7 rule 1).
    never_for_super_admin = {Capability.VIEW_OWN_CHANGE_REQUESTS, Capability.REQUEST_CORRECTIONS}
    for capability in Capability:
        expected = None if capability in never_for_super_admin else Access.ALL
        assert PERMISSIONS[capability].get(Role.SUPER_ADMIN) == expected


@pytest.mark.parametrize(
    ("role", "capability", "expected"),
    [
        (Role.CORPORATE_HEAD, Capability.CHANGE_EMPLOYEES, Access.VIA_APPROVAL),
        (Role.CORPORATE_HEAD, Capability.MARK_EMPLOYEE_LEFT, None),
        (Role.CORPORATE_HEAD, Capability.EDIT_PLANT_SETUP, None),
        (Role.PLANT_HEAD, Capability.CHANGE_EMPLOYEES, None),
        (Role.PLANT_HEAD, Capability.VIEW_EMPLOYEES, Access.OWN_PLANT),
        (Role.PLANT_HEAD, Capability.MANAGE_KIOSKS, Access.OWN_PLANT),
        (Role.PLANT_HEAD, Capability.EDIT_PLANT_SETUP, None),
        (Role.PLANT_HEAD, Capability.DECIDE_CHANGE_REQUESTS, None),
    ],
)
def test_matrix_matches_decision_0005(
    role: Role, capability: Capability, expected: Access | None
) -> None:
    assert access_for(role.value, capability) == expected
