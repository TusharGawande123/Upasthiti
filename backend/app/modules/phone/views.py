"""What the phone pages and the admin "Phone attendance" card show (M4b spec §5.1, §5.5).

Read only. The admin card shows IP addresses to the Super Admin only; Corporate Heads and Plant
Heads see the same card without them (spec §7 rule 1).
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.time import to_ist, today_ist, utc_now
from app.modules.employees.models import Employee, PunchMethod
from app.modules.face.consent_service import active_consent
from app.modules.face.engine_provider import running_model_id
from app.modules.face.template_service import active_template
from app.modules.org.geofence_service import current_geofence
from app.modules.org.models import Plant
from app.modules.phone.access import access_of, outside_work_allowed_on
from app.modules.phone.access_service import account_of
from app.modules.phone.models import PhoneAccount, PhonePasskey
from app.modules.phone.notice import CURRENT_VERSION, acceptance_of, notice_required
from app.modules.phone.passkey_service import active_passkeys
from app.modules.phone.schemas import (
    AccountView,
    LastPunch,
    MeAccess,
    MeEmployee,
    MeGeofence,
    MeNotice,
    MeReady,
    MeResponse,
    MeSettings,
    MeToday,
    NoticeView,
    PasskeyItem,
    PhoneAccessView,
    PlantFull,
    PlantShort,
    SessionView,
    SignedInEmployee,
)
from app.modules.phone.sessions import alive_sessions
from app.modules.punches.counting import last_counted_before
from app.modules.punches.face_service import capture_rules
from app.modules.settings.service import get_int_setting


def first_name(employee: Employee) -> str:
    parts = employee.full_name.split()
    return parts[0] if parts else employee.full_name


def signed_in_employee(session: Session, employee: Employee) -> SignedInEmployee:
    plant = session.get(Plant, employee.plant_id)
    return SignedInEmployee(
        code=employee.employee_code,
        name=employee.full_name,
        plant=PlantShort(code=plant.code if plant else "", name=plant.name if plant else ""),
        punch_method=employee.punch_method,  # type: ignore[arg-type]
    )


def face_ready(session: Session, employee: Employee) -> bool:
    """A face employee can punch by phone only with an agreed consent and a template of the
    running model (spec §7 rule 10, PHONE_FACE_NOT_READY otherwise)."""
    if employee.punch_method != PunchMethod.FACE.value:
        return False
    if active_consent(session, employee.id) is None:
        return False
    template = active_template(session, employee.id)
    return template is not None and template.model_id == running_model_id()


def passkey_items(passkeys: list[PhonePasskey]) -> list[PasskeyItem]:
    return [
        PasskeyItem(
            id=passkey.id,
            label=passkey.label,
            created_at=passkey.created_at,
            last_used_at=passkey.last_used_at,
        )
        for passkey in passkeys
    ]


def me(session: Session, employee: Employee) -> MeResponse:
    now = utc_now()
    plant = session.get(Plant, employee.plant_id)
    access = access_of(session, employee.id)
    fence = current_geofence(session, employee.plant_id)
    return MeResponse(
        employee=MeEmployee(
            code=employee.employee_code,
            name=employee.full_name,
            first_name=first_name(employee),
            plant=PlantFull(
                id=employee.plant_id,
                code=plant.code if plant else "",
                name=plant.name if plant else "",
            ),
            punch_method=employee.punch_method,  # type: ignore[arg-type]
        ),
        access=MeAccess(
            outside_work_allowed=outside_work_allowed_on(access, today_ist()),
            outside_work_until=access.outside_work_until if access else None,
        ),
        notice=MeNotice(required=notice_required(session, employee.id), version=CURRENT_VERSION),
        ready=MeReady(face=face_ready(session, employee)),
        passkeys=passkey_items(active_passkeys(session, employee.id)),
        today=MeToday(last_punch=_last_punch_today(session, employee, now)),
        settings=MeSettings(
            gps_accuracy_limit_m=get_int_setting(session, "gps_accuracy_limit_m"),
            location_max_age_seconds=get_int_setting(session, "phone_location_max_age_seconds"),
            challenge_seconds=get_int_setting(session, "face_challenge_seconds"),
            photo_ready_seconds=get_int_setting(session, "kiosk_photo_ready_seconds"),
            capture=capture_rules(session),
        ),
        geofence=MeGeofence(
            version_id=fence.id,
            shape=fence.shape,
            geojson=fence.geojson,
            radius_m=float(fence.radius_m) if fence.radius_m is not None else None,
            buffer_m=fence.buffer_m,
        )
        if fence is not None
        else None,
    )


def _last_punch_today(session: Session, employee: Employee, now: datetime) -> LastPunch | None:
    """Today's last counted punch, from the gate or the phone ("IN at 07:02, attendance device")."""
    counted = last_counted_before(session, employee.id, now + timedelta(seconds=1))
    if counted is None or to_ist(counted.punch_time).date() != to_ist(now).date():
        return None
    return LastPunch(
        direction=counted.direction,  # type: ignore[arg-type]
        time=counted.punch_time,
        channel=counted.punch.channel,  # type: ignore[arg-type]
    )


# --- The admin card -------------------------------------------------------------------------------


def admin_view(session: Session, employee: Employee, *, show_ip: bool) -> PhoneAccessView:
    now = utc_now()
    access = access_of(session, employee.id)
    account = account_of(session, employee.id)
    accepted = acceptance_of(session, employee.id)
    until = access.outside_work_until if access else None
    return PhoneAccessView(
        phone_punch_enabled=bool(access and access.phone_punch_enabled),
        phone_changed_at=access.phone_changed_at if access else None,
        phone_changed_by=access.phone_changed_by if access else None,
        outside_work_allowed=bool(access and access.outside_work_allowed),
        outside_work_until=until,
        outside_work_ended=bool(
            access and access.outside_work_allowed and until is not None and until < today_ist()
        ),
        outside_changed_at=access.outside_changed_at if access else None,
        outside_changed_by=access.outside_changed_by if access else None,
        account=_account_view(account, now),
        notice=NoticeView(version=accepted.version, accepted_at=accepted.accepted_at)
        if accepted
        else None,
        sessions=[
            SessionView(
                id=row.id,
                started_at=row.created_at,
                last_seen_at=row.last_seen_at,
                expires_at=row.expires_at,
                browser=row.browser,
                system=row.system,
                ip=str(row.ip) if show_ip and row.ip else None,
            )
            for row in reversed(alive_sessions(session, employee.id, now))
        ],
        passkeys=passkey_items(active_passkeys(session, employee.id)),
    )


def _account_view(account: PhoneAccount | None, now: datetime) -> AccountView:
    if account is None or account.password_hash is None:
        state = (
            "new_password_required"
            if account is not None and account.new_password_required_at is not None
            else "no_password"
        )
    elif account.locked_until is not None and account.locked_until > now:
        state = "locked"
    else:
        state = "active"
    return AccountView(
        state=state,  # type: ignore[arg-type]
        password_set_at=account.password_set_at if account else None,
        proof_kind=account.proof_kind if account else None,  # type: ignore[arg-type]
        locked_until=account.locked_until
        if account and account.locked_until and account.locked_until > now
        else None,
    )
