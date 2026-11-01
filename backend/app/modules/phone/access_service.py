"""Changing who may punch by phone (M4b spec §7 rules 3, 29; §8.4).

- The Super Admin switches "Phone punching" and "Outside work allowed" (with a reason), signs out
  all phones, requires a new password and removes a passkey.
- The employee stops phone punching themselves (DPDP: withdrawing is as easy as giving).
- "Mark as left" ends everything in the same transaction as the card revoke and the face delete.
- The daily job turns an outside-work switch off after its "until" date (F-69).
Every change writes an audit row with the reason; passwords, tokens and keys never go into it.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules.audit.service import SYSTEM_ACTOR, Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.phone.access import access_of
from app.modules.phone.models import (
    PasskeyRemoveKind,
    PhoneAccess,
    PhoneAccount,
    PhonePasskey,
    SessionRevokeKind,
)
from app.modules.phone.sessions import end_all, lock_employee

UNTIL_PASSED_REASON = "Until date passed"


@dataclass(frozen=True)
class SwitchState:
    phone_punch_enabled: bool
    outside_work_allowed: bool
    outside_work_until: date | None

    @classmethod
    def of(cls, access: PhoneAccess | None) -> SwitchState:
        if access is None:
            return cls(False, False, None)
        return cls(
            access.phone_punch_enabled, access.outside_work_allowed, access.outside_work_until
        )

    def as_audit(self) -> dict[str, object]:
        return {
            "phone_punch_enabled": self.phone_punch_enabled,
            "outside_work_allowed": self.outside_work_allowed,
            "outside_work_until": self.outside_work_until,
        }


# --- Rows ----------------------------------------------------------------------------------------


def access_row(session: Session, employee_id: uuid.UUID, now: datetime) -> PhoneAccess:
    """The switches row, made (both OFF) the first time a switch is used."""
    access = access_of(session, employee_id)
    if access is None:
        access = PhoneAccess(
            employee_id=employee_id,
            phone_punch_enabled=False,
            outside_work_allowed=False,
            phone_changed_at=now,
        )
        session.add(access)
        session.flush()
    return access


def account_of(session: Session, employee_id: uuid.UUID) -> PhoneAccount | None:
    return session.scalar(select(PhoneAccount).where(PhoneAccount.employee_id == employee_id))


def account_row(session: Session, employee_id: uuid.UUID) -> PhoneAccount:
    account = account_of(session, employee_id)
    if account is None:
        account = PhoneAccount(employee_id=employee_id, failed_login_count=0)
        session.add(account)
        session.flush()
    return account


def remove_all_passkeys(
    session: Session,
    employee_id: uuid.UUID,
    kind: PasskeyRemoveKind,
    now: datetime,
    removed_by: uuid.UUID | None = None,
) -> int:
    """Mark every active passkey of the employee as removed (never deleted). Caller commits."""
    removed = session.execute(
        update(PhonePasskey)
        .where(PhonePasskey.employee_id == employee_id, PhonePasskey.removed_at.is_(None))
        .values(removed_at=now, removed_by=removed_by, remove_kind=kind.value)
        .returning(PhonePasskey.id)
        .execution_options(synchronize_session="fetch")
    ).all()
    return len(removed)


# --- The Super Admin's switches ------------------------------------------------------------------


def set_phone_punching(
    session: Session, actor: Actor, employee: Employee, *, enabled: bool, reason: str
) -> None:
    if enabled and employee.status == EmployeeStatus.LEFT.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    lock_employee(session, employee.id)
    now = utc_now()
    before = SwitchState.of(access_of(session, employee.id))
    if before.phone_punch_enabled == enabled:
        raise ApiError(
            "PHONE_ACCESS_UNCHANGED", "Phone punching is already switched this way.", 409
        )

    access = access_row(session, employee.id, now)
    access.phone_punch_enabled = enabled
    access.phone_changed_at = now
    access.phone_changed_by = actor.actor_id
    ended = 0
    if not enabled:
        # OFF ends everything that depends on it; the password stays, so switching ON again
        # later works without a new proof (spec §7 rule 3).
        _outside_off(access, actor.actor_id, now)
        ended = end_all(session, employee.id, SessionRevokeKind.PHONE_OFF, now)
        remove_all_passkeys(session, employee.id, PasskeyRemoveKind.PHONE_OFF, now)
    _audit_switch(
        session,
        actor,
        employee,
        "phone_access.enable" if enabled else "phone_access.disable",
        before,
        SwitchState.of(access),
        reason,
        extra={"sessions_ended": ended} if ended else None,
    )
    session.commit()


def set_outside_work(
    session: Session,
    actor: Actor,
    employee: Employee,
    *,
    allowed: bool,
    reason: str,
    until: date | None,
) -> None:
    if employee.status == EmployeeStatus.LEFT.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    lock_employee(session, employee.id)
    now = utc_now()
    access = access_of(session, employee.id)
    before = SwitchState.of(access)
    if allowed:
        _check_outside_allowed(employee, before, until)
    else:
        until = None
    if before.outside_work_allowed == allowed and before.outside_work_until == until:
        return  # nothing to change, nothing to audit

    access = access_row(session, employee.id, now)
    access.outside_work_allowed = allowed
    access.outside_work_until = until
    access.outside_changed_at = now
    access.outside_changed_by = actor.actor_id
    action = "phone_access.outside_on" if allowed else "phone_access.outside_off"
    _audit_switch(session, actor, employee, action, before, SwitchState.of(access), reason)
    session.commit()


def _check_outside_allowed(employee: Employee, before: SwitchState, until: date | None) -> None:
    if not before.phone_punch_enabled:
        raise ApiError("PHONE_PUNCH_OFF", "Switch phone punching on first.", 409)
    # The gate-code path is always at the gate, so outside work is only for face employees.
    if employee.punch_method != PunchMethod.FACE.value:
        raise ApiError(
            "EMPLOYEE_NOT_FACE",
            "Outside work is only for employees who punch with their face.",
            409,
        )
    if until is not None and until < today_ist():
        raise ApiError("OUTSIDE_UNTIL_INVALID", "The end date cannot be in the past.", 422)


def sign_out_all(session: Session, actor: Actor, employee: Employee, *, reason: str) -> int:
    lock_employee(session, employee.id)
    ended = end_all(session, employee.id, SessionRevokeKind.ADMIN, utc_now())
    record_audit(
        session,
        actor=actor,
        action="phone_account.sessions_ended",
        entity_type="employee",
        entity_id=employee.id,
        after={"sessions_ended": ended},
        reason=reason,
        plant_id=employee.plant_id,
    )
    session.commit()
    return ended


def require_new_password(
    session: Session, actor: Actor, employee: Employee, *, reason: str
) -> None:
    """The password is removed (the employee proves who they are again), the lock is cleared,
    every phone is signed out and every passkey removed (spec §7 rules 7, 29; AC-17)."""
    lock_employee(session, employee.id)
    now = utc_now()
    account = account_row(session, employee.id)
    account.password_hash = None
    account.password_set_at = None
    account.proof_kind = None
    account.failed_login_count = 0
    account.locked_until = None
    account.new_password_required_at = now
    ended = end_all(session, employee.id, SessionRevokeKind.NEW_PASSWORD, now)
    removed = remove_all_passkeys(
        session, employee.id, PasskeyRemoveKind.NEW_PASSWORD, now, actor.actor_id
    )
    record_audit(
        session,
        actor=actor,
        action="phone_account.new_password_required",
        entity_type="employee",
        entity_id=employee.id,
        after={"sessions_ended": ended, "passkeys_removed": removed},
        reason=reason,
        plant_id=employee.plant_id,
    )
    session.commit()


def remove_passkey_by_admin(
    session: Session, actor: Actor, employee: Employee, passkey_id: uuid.UUID, *, reason: str
) -> None:
    passkey = session.get(PhonePasskey, passkey_id)
    if passkey is None or passkey.employee_id != employee.id or passkey.removed_at is not None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    passkey.removed_at = utc_now()
    passkey.removed_by = actor.actor_id
    passkey.remove_kind = PasskeyRemoveKind.ADMIN.value
    record_audit(
        session,
        actor=actor,
        action="phone_passkey.remove",
        entity_type="employee",
        entity_id=employee.id,
        after={"passkey_id": passkey.id, "remove_kind": PasskeyRemoveKind.ADMIN.value},
        reason=reason,
        plant_id=employee.plant_id,
    )
    session.commit()


# --- The employee and the system -----------------------------------------------------------------


def stop_by_employee(session: Session, actor: Actor, employee: Employee) -> None:
    """ "Stop phone punching" on the phone: OFF, sign-ins ended, passkeys removed. Only the Super
    Admin can switch it on again (spec §7 rule 3, AC-19)."""
    lock_employee(session, employee.id)
    now = utc_now()
    access = access_row(session, employee.id, now)
    before = SwitchState.of(access)
    access.phone_punch_enabled = False
    access.phone_changed_at = now
    access.phone_changed_by = None  # None = the employee themselves
    _outside_off(access, None, now)
    ended = end_all(session, employee.id, SessionRevokeKind.SELF_STOP, now)
    remove_all_passkeys(session, employee.id, PasskeyRemoveKind.PHONE_OFF, now)
    _audit_switch(
        session,
        actor,
        employee,
        "phone_access.self_disabled",
        before,
        SwitchState.of(access),
        None,
        extra={"sessions_ended": ended},
    )
    session.commit()


def end_phone_for_leaver(session: Session, actor: Actor, employee: Employee, reason: str) -> None:
    """Part of "mark as left" (spec §7 rule 3, AC-9): both switches OFF, sign-ins ended (`left`),
    password removed, passkeys removed. Does NOT commit: the caller saves it together with the
    card revoke and the face data delete. Reactivation brings nothing back."""
    now = utc_now()
    access = access_of(session, employee.id)
    before = SwitchState.of(access)
    if access is not None:
        access.phone_punch_enabled = False
        access.phone_changed_at = now
        access.phone_changed_by = None  # None = the "mark as left" step
        _outside_off(access, None, now)
    account = account_of(session, employee.id)
    if account is not None:
        account.password_hash = None
        account.password_set_at = None
        account.proof_kind = None
    end_all(session, employee.id, SessionRevokeKind.LEFT, now)
    remove_all_passkeys(session, employee.id, PasskeyRemoveKind.LEFT, now)
    if before.phone_punch_enabled:
        _audit_switch(
            session, actor, employee, "phone_access.disable", before, SwitchState.of(access), reason
        )
    session.flush()


def end_expired_outside_work(session: Session, today: date) -> int:
    """F-69 (AC-49): an outside-work switch whose "until" day is over is turned OFF the next
    morning, so lists stay honest. The rule already treated it as OFF since midnight."""
    ended = list(
        session.scalars(
            select(PhoneAccess).where(
                PhoneAccess.outside_work_allowed.is_(True),
                PhoneAccess.outside_work_until.is_not(None),
                PhoneAccess.outside_work_until < today,
            )
        )
    )
    now = utc_now()
    for access in ended:
        employee = session.get(Employee, access.employee_id)
        before = SwitchState.of(access)
        _outside_off(access, None, now)
        if employee is not None:
            _audit_switch(
                session,
                SYSTEM_ACTOR,
                employee,
                "phone_access.outside_off",
                before,
                SwitchState.of(access),
                UNTIL_PASSED_REASON,
            )
    session.commit()
    return len(ended)


# --- Helpers -------------------------------------------------------------------------------------


def _outside_off(access: PhoneAccess, changed_by: uuid.UUID | None, now: datetime) -> None:
    if access.outside_work_allowed or access.outside_work_until is not None:
        access.outside_work_allowed = False
        access.outside_work_until = None
        access.outside_changed_at = now
        access.outside_changed_by = changed_by


def _audit_switch(
    session: Session,
    actor: Actor,
    employee: Employee,
    action: str,
    before: SwitchState,
    after: SwitchState,
    reason: str | None,
    extra: dict[str, object] | None = None,
) -> None:
    record_audit(
        session,
        actor=actor,
        action=action,
        entity_type="employee",
        entity_id=employee.id,
        before=before.as_audit(),
        after=after.as_audit() | (extra or {}),
        reason=reason,
        plant_id=employee.plant_id,
    )
