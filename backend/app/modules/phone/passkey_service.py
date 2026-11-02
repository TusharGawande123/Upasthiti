"""Passkeys: an optional second way to sign in on the phone (F-80, M4b spec §7 rule 29).

Free and standard: the browser's own WebAuthn and, here, `webauthn` (py_webauthn, BSD-3-Clause)
to make the options and check the answers (signature, challenge, origin, site name, user
verification, counter). The fingerprint, face unlock or phone PIN never leaves the phone: the
server keeps only a public key, a counter, a user handle and a label. Challenges are stored as a
hash in `phone_proofs` (single use, 5 minutes). The password always keeps working.
"""

import binascii
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import DEVELOPMENT_ORIGIN, get_settings
from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus
from app.modules.employees.rules import clean_code
from app.modules.phone.access_service import account_of
from app.modules.phone.dependencies import PhoneEmployee
from app.modules.phone.models import (
    PasskeyRemoveKind,
    PhonePasskey,
    PhoneProof,
    ProofKind,
    SignInMethod,
)
from app.modules.phone.rate_limits import passkey_add_limiter
from app.modules.phone.sign_in_service import (
    SignedIn,
    check_may_sign_in,
    check_sign_in_limit,
    find_employee_by_code,
    finish_sign_in,
)
from app.modules.phone.user_agent import PhoneKind

MAX_PASSKEYS = 3
CHALLENGE_LIFE = timedelta(minutes=5)
RECENT_SIGN_IN = timedelta(minutes=10)
RP_NAME = "Upasthiti"
# Any failure of a working-looking answer: a broken JSON, a wrong signature, origin or site name.
_BAD_ANSWER = (WebAuthnException, ValueError, KeyError, TypeError, binascii.Error)


# --- The website the passkeys belong to -----------------------------------------------------------


def relying_party() -> tuple[str, str]:
    """(site name, origin): the host of APP_PUBLIC_ORIGIN. Passkeys are bound to it, so a move to
    another host name means new passkeys (the password still works)."""
    settings = get_settings()
    if settings.app_public_origin:
        origin = settings.app_public_origin.rstrip("/")
        host = urlsplit(origin).hostname
        if host:
            return host, origin
    if settings.app_env == "development":
        return "localhost", DEVELOPMENT_ORIGIN
    raise ApiError("PASSKEYS_NOT_CONFIGURED", "Passkeys are not set up on this server.", 503)


def user_handle_for(session: Session, employee: Employee) -> bytes:
    """The same 32 bytes for all of an employee's passkeys, never the employee code. An earlier
    passkey's handle is reused; the first one is derived from the server secret, so it looks
    random to everyone else and needs no extra storage between the two registration steps."""
    existing = session.scalar(
        select(PhonePasskey.user_handle)
        .where(PhonePasskey.employee_id == employee.id)
        .order_by(PhonePasskey.created_at)
        .limit(1)
    )
    if existing is not None:
        return existing
    secret = get_settings().app_secret_key.encode("utf-8")
    return hmac.new(secret, b"passkey-user-handle-v1:" + employee.id.bytes, hashlib.sha256).digest()


# --- Adding a passkey (signed in) -----------------------------------------------------------------


def registration_options(session: Session, caller: PhoneEmployee) -> dict[str, Any]:
    rp_id, _origin = relying_party()
    now = utc_now()
    _check_recent_sign_in(caller, now)
    active = active_passkeys(session, caller.employee.id)
    _check_room(active)
    employee = caller.employee
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=user_handle_for(session, employee),
        user_name=employee.employee_code,
        user_display_name=employee.full_name,
        timeout=int(CHALLENGE_LIFE.total_seconds() * 1000),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[_descriptor(passkey) for passkey in active],
    )
    _store_challenge(
        session, ProofKind.PASSKEY_REGISTER, options.challenge, now, employee_id=employee.id
    )
    return json.loads(options_to_json(options))


def register(session: Session, caller: PhoneEmployee, credential: dict[str, Any]) -> PhonePasskey:
    rp_id, origin = relying_party()
    now = utc_now()
    _check_recent_sign_in(caller, now)
    if not passkey_add_limiter.allow(str(caller.phone_session.id)):
        raise ApiError("TOO_MANY_REQUESTS", "Too many passkeys added. Try again later.", 429)
    employee = caller.employee
    _check_room(active_passkeys(session, employee.id))
    try:
        challenge = _challenge_of(credential)
        _use_challenge(session, ProofKind.PASSKEY_REGISTER, challenge, now, employee_id=employee.id)
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except _BAD_ANSWER:
        session.commit()  # a used challenge stays used
        raise _invalid(422) from None
    if session.scalar(
        select(PhonePasskey.id).where(PhonePasskey.credential_id == verified.credential_id)
    ):
        session.commit()
        raise _invalid(422)
    passkey = PhonePasskey(
        employee_id=employee.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        user_handle=user_handle_for(session, employee),
        transports=_transports(credential),
        label=PhoneKind(caller.phone_session.browser, caller.phone_session.system).label[:60],
        created_at=now,
    )
    session.add(passkey)
    session.flush()
    record_audit(
        session,
        actor=caller.actor,
        action="phone_passkey.add",
        entity_type="employee",
        entity_id=employee.id,
        after={"passkey_id": passkey.id, "label": passkey.label},
        plant_id=employee.plant_id,
    )
    session.commit()
    return passkey


def remove_own(session: Session, caller: PhoneEmployee, passkey_id: uuid.UUID) -> None:
    passkey = session.get(PhonePasskey, passkey_id)
    if (
        passkey is None
        or passkey.employee_id != caller.employee.id
        or passkey.removed_at is not None
    ):
        raise ApiError("NOT_FOUND", "Not found.", 404)
    passkey.removed_at = utc_now()
    passkey.remove_kind = PasskeyRemoveKind.SELF.value
    record_audit(
        session,
        actor=caller.actor,
        action="phone_passkey.remove",
        entity_type="employee",
        entity_id=caller.employee.id,
        after={"passkey_id": passkey.id, "remove_kind": PasskeyRemoveKind.SELF.value},
        plant_id=caller.employee.plant_id,
    )
    session.commit()


def active_passkeys(session: Session, employee_id: uuid.UUID) -> list[PhonePasskey]:
    return list(
        session.scalars(
            select(PhonePasskey)
            .where(PhonePasskey.employee_id == employee_id, PhonePasskey.removed_at.is_(None))
            .order_by(PhonePasskey.created_at)
        )
    )


# --- Signing in with a passkey (public) ----------------------------------------------------------


def login_options(session: Session, *, employee_code: str, ip: str) -> dict[str, Any]:
    """Options for ANY well-formed code; no passkey (or no such code) gets one made-up key id."""
    check_sign_in_limit(ip)
    rp_id, _origin = relying_party()
    now = utc_now()
    employee = find_employee_by_code(session, employee_code)
    keys = active_passkeys(session, employee.id) if employee is not None else []
    code = clean_code(employee_code)
    # Same shape for everybody: a code without a passkey gets one made-up credential id, so the
    # answer does not tell whether the code exists or has a passkey.
    descriptors = [_descriptor(passkey) for passkey in keys] or [_dummy_descriptor(code)]
    options = generate_authentication_options(
        rp_id=rp_id,
        timeout=int(CHALLENGE_LIFE.total_seconds() * 1000),
        allow_credentials=descriptors,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    _store_challenge(
        session,
        ProofKind.PASSKEY_LOGIN,
        options.challenge,
        now,
        claimed_code=code[:12],
    )
    return json.loads(options_to_json(options))


def login(
    session: Session,
    *,
    employee_code: str,
    credential: dict[str, Any],
    ip: str,
    user_agent: str | None,
) -> SignedIn:
    """Every failure is ONE answer, PASSKEY_INVALID, and never counts towards the password
    lockout (a passkey cannot guess a password). A counter that went back is refused and audited;
    the passkey stays."""
    check_sign_in_limit(ip)
    rp_id, origin = relying_party()
    now = utc_now()
    code = clean_code(employee_code)[:12]
    employee = find_employee_by_code(session, code)
    try:
        challenge = _challenge_of(credential)
        _use_challenge(session, ProofKind.PASSKEY_LOGIN, challenge, now, claimed_code=code)
        if employee is None or employee.status != EmployeeStatus.ACTIVE.value:
            raise ValueError("no such employee")
        passkey = _passkey_of(session, employee, credential)
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except _BAD_ANSWER:
        _record_failure(session, code, employee, ip)
        raise _invalid(401) from None
    passkey.sign_count = verified.new_sign_count
    passkey.last_used_at = now
    check_may_sign_in(session, employee, account_of(session, employee.id))
    return finish_sign_in(
        session, employee, method=SignInMethod.PASSKEY, ip=ip, user_agent=user_agent, now=now
    )


def _passkey_of(session: Session, employee: Employee, credential: dict[str, Any]) -> PhonePasskey:
    raw_id = base64url_to_bytes(str(credential.get("rawId") or credential["id"]))
    passkey = session.scalar(
        select(PhonePasskey).where(
            PhonePasskey.credential_id == raw_id,
            PhonePasskey.employee_id == employee.id,
            PhonePasskey.removed_at.is_(None),
        )
    )
    if passkey is None:
        raise ValueError("no such passkey")
    return passkey


# --- Helpers --------------------------------------------------------------------------------------


def _check_recent_sign_in(caller: PhoneEmployee, now: datetime) -> None:
    """Only within 10 minutes of a password or proof sign-in, so a borrowed open session (or a
    passkey sign-in) cannot add a passkey to keep access."""
    phone_session = caller.phone_session
    recent = phone_session.created_at >= now - RECENT_SIGN_IN
    if not recent or phone_session.sign_in_method == SignInMethod.PASSKEY.value:
        raise ApiError(
            "PHONE_RECENT_SIGN_IN_REQUIRED",
            "Please sign in with your password again to add a passkey.",
            403,
        )


def _check_room(active: list[PhonePasskey]) -> None:
    if len(active) >= MAX_PASSKEYS:
        raise ApiError(
            "PASSKEY_LIMIT_REACHED", "You already have 3 passkeys. Remove one first.", 409
        )


def _store_challenge(
    session: Session,
    kind: ProofKind,
    challenge: bytes,
    now: datetime,
    *,
    employee_id: uuid.UUID | None = None,
    claimed_code: str | None = None,
) -> None:
    session.add(
        PhoneProof(
            kind=kind.value,
            claimed_code=claimed_code,
            employee_id=employee_id,
            webauthn_challenge_sha256=hashlib.sha256(challenge).hexdigest(),
            issued_at=now,
            expires_at=now + CHALLENGE_LIFE,
        )
    )
    session.commit()


def _challenge_of(credential: dict[str, Any]) -> bytes:
    """The challenge the phone signed, read from its clientDataJSON. Only a hash is stored, so
    the stored row is found by this value; the library then checks it again."""
    client_data = base64url_to_bytes(str(credential["response"]["clientDataJSON"]))
    return base64url_to_bytes(str(json.loads(client_data)["challenge"]))


def _use_challenge(
    session: Session,
    kind: ProofKind,
    challenge: bytes,
    now: datetime,
    *,
    employee_id: uuid.UUID | None = None,
    claimed_code: str | None = None,
) -> PhoneProof:
    statement = select(PhoneProof).where(
        PhoneProof.kind == kind.value,
        PhoneProof.webauthn_challenge_sha256 == hashlib.sha256(challenge).hexdigest(),
        PhoneProof.used_at.is_(None),
        PhoneProof.expires_at >= now,
    )
    if employee_id is not None:
        statement = statement.where(PhoneProof.employee_id == employee_id)
    if claimed_code is not None:
        statement = statement.where(PhoneProof.claimed_code == claimed_code)
    proof = session.scalar(statement.with_for_update())
    if proof is None:
        raise ValueError("unknown, used or expired challenge")
    proof.used_at = now
    return proof


def _dummy_descriptor(code: str) -> PublicKeyCredentialDescriptor:
    """A credential id that belongs to nobody: HMAC of the code, so it is stable per code and
    needs no storage. A phone offers it to the user, finds no such key and the sign-in fails."""
    secret = get_settings().app_secret_key.encode("utf-8")
    fake_id = hmac.new(secret, b"passkey-dummy-credential-v1:" + code.encode(), hashlib.sha256)
    return PublicKeyCredentialDescriptor(id=fake_id.digest())


def _descriptor(passkey: PhonePasskey) -> PublicKeyCredentialDescriptor:
    transports = []
    for name in passkey.transports or []:
        try:
            transports.append(AuthenticatorTransport(name))
        except ValueError:
            continue  # a transport this library does not know is simply left out
    return PublicKeyCredentialDescriptor(id=passkey.credential_id, transports=transports or None)


def _transports(credential: dict[str, Any]) -> list[str]:
    response = credential.get("response")
    names = response.get("transports") if isinstance(response, dict) else None
    if not isinstance(names, list):
        return []
    return [str(name)[:20] for name in names if isinstance(name, str)][:8]


def _record_failure(session: Session, code: str, employee: Employee | None, ip: str) -> None:
    record_audit(
        session,
        actor=Actor("employee", None, ip),
        action="phone_auth.login_failed",
        entity_type="employee",
        entity_id=employee.id if employee else None,
        after={"code": code, "method": "passkey"},
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()


def _invalid(status_code: int) -> ApiError:
    return ApiError(
        "PASSKEY_INVALID",
        "The passkey did not work. Please sign in with your password.",
        status_code,
    )
