"""The expected answer of every route for every kind of caller (M6 AC-M6-9, spec 7.3 row A01).

One row per route (method and path as FastAPI lists them). The audience says who may call it:
the table is written out by hand so a wrong rule in permissions.py cannot hide itself, and
test_m6_role_matrix.py checks both directions: a route without a row fails (a new route needs a
decision), and a row without a route fails (no stale rows). The six callers are:
anonymous, Super Admin, Corporate Head, Plant Head, attendance device (signed requests), phone
employee (the `ups_phone` cookie).
"""

import enum

ANONYMOUS = "anonymous"
SUPER_ADMIN = "super_admin"
CORPORATE_HEAD = "corporate_head"
PLANT_HEAD = "plant_head"
DEVICE = "device"
PHONE_EMPLOYEE = "phone_employee"
IDENTITIES = (ANONYMOUS, SUPER_ADMIN, CORPORATE_HEAD, PLANT_HEAD, DEVICE, PHONE_EMPLOYEE)

ADMIN_ROLES = (SUPER_ADMIN, CORPORATE_HEAD, PLANT_HEAD)

# What a cell expects. "open" = the caller is let in (the answer may still be 400, 404 or 422
# because the test sends an empty body and a made-up id); 401 = not recognised; 403 = recognised
# but not allowed.
OPEN = "open"
NOT_SIGNED_IN = 401
NOT_ALLOWED = 403


class Audience(enum.Enum):
    PUBLIC = "public"  # nobody needs to sign in (login, health, privacy notice, pairing)
    ANY_ADMIN = "any_admin"  # every signed-in admin role, no capability (own account, search)
    ALL_ADMINS = "all_admins"  # Super Admin, Corporate Head and Plant Head (reads; scoped inside)
    SUPER = "super"  # Super Admin only
    SUPER_CORP = "super_corp"  # Super Admin and Corporate Head (employee changes)
    SUPER_PLANT = "super_plant"  # Super Admin and Plant Head (own devices, notices, poster)
    CORP = "corp"  # Corporate Head only (own change requests)
    DEVICE = "device"  # a paired attendance device with a signed request
    PHONE = "phone"  # a signed-in phone employee


# Who is let in per audience. Everyone else gets 401 (not recognised) or 403 (recognised admin
# with the wrong role).
ALLOWED: dict[Audience, frozenset[str]] = {
    Audience.PUBLIC: frozenset(IDENTITIES),
    Audience.ANY_ADMIN: frozenset(ADMIN_ROLES),
    Audience.ALL_ADMINS: frozenset(ADMIN_ROLES),
    Audience.SUPER: frozenset({SUPER_ADMIN}),
    Audience.SUPER_CORP: frozenset({SUPER_ADMIN, CORPORATE_HEAD}),
    Audience.SUPER_PLANT: frozenset({SUPER_ADMIN, PLANT_HEAD}),
    Audience.CORP: frozenset({CORPORATE_HEAD}),
    Audience.DEVICE: frozenset({DEVICE}),
    Audience.PHONE: frozenset({PHONE_EMPLOYEE}),
}


def expected_answer(audience: Audience, identity: str) -> str | int:
    """OPEN, or the status code the caller must get (401 or 403)."""
    if identity in ALLOWED[audience]:
        return OPEN
    if audience in (Audience.DEVICE, Audience.PHONE):
        return NOT_SIGNED_IN  # these two never use an admin session
    if identity in ADMIN_ROLES:
        return NOT_ALLOWED
    return NOT_SIGNED_IN


# Method and path -> audience, grouped by module. The comment names the capability of
# permissions.py that the route asks for.
ROUTE_AUDIENCE: dict[tuple[str, str], Audience] = {
    # --- attendance ---
    ("GET", "/api/v1/attendance/daily"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("GET", "/api/v1/attendance/employee/{employee_id}"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "GET",
        "/api/v1/attendance/employee/{employee_id}/day/{day}",
    ): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "GET",
        "/api/v1/attendance/employee/{employee_id}/range",
    ): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "GET",
        "/api/v1/attendance/employee/{employee_id}/year",
    ): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/attendance/recompute"): Audience.SUPER,  # RECOMPUTE_ATTENDANCE
    ("GET", "/api/v1/attendance/register"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("GET", "/api/v1/attendance/register-range"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("GET", "/api/v1/attendance/undecided"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- audit ---
    ("GET", "/api/v1/audit"): Audience.ALL_ADMINS,  # VIEW_AUDIT
    # --- auth ---
    ("POST", "/api/v1/auth/change-password"): Audience.ANY_ADMIN,
    ("POST", "/api/v1/auth/login"): Audience.PUBLIC,
    ("POST", "/api/v1/auth/logout"): Audience.ANY_ADMIN,
    ("GET", "/api/v1/auth/me"): Audience.ANY_ADMIN,
    ("GET", "/api/v1/auth/sessions"): Audience.ANY_ADMIN,
    ("DELETE", "/api/v1/auth/sessions/{login_session_id}"): Audience.ANY_ADMIN,
    # --- categories ---
    ("PATCH", "/api/v1/categories/{item_id}"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/categories/{item_id}/deactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/categories/{item_id}/reactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    # --- change-requests ---
    ("GET", "/api/v1/change-requests"): Audience.SUPER_CORP,  # decide or view own
    ("GET", "/api/v1/change-requests/pending-count"): Audience.SUPER,  # DECIDE_CHANGE_REQUESTS
    ("GET", "/api/v1/change-requests/{request_id}"): Audience.ANY_ADMIN,
    (
        "POST",
        "/api/v1/change-requests/{request_id}/approve",
    ): Audience.SUPER,  # DECIDE_CHANGE_REQUESTS
    (
        "POST",
        "/api/v1/change-requests/{request_id}/reject",
    ): Audience.SUPER,  # DECIDE_CHANGE_REQUESTS
    (
        "POST",
        "/api/v1/change-requests/{request_id}/withdraw",
    ): Audience.CORP,  # VIEW_OWN_CHANGE_REQUESTS
    # --- contractors ---
    ("GET", "/api/v1/contractors"): Audience.ALL_ADMINS,  # VIEW_CONTRACTORS
    ("POST", "/api/v1/contractors"): Audience.SUPER,  # MANAGE_CONTRACTORS
    ("PATCH", "/api/v1/contractors/{contractor_id}"): Audience.SUPER,  # MANAGE_CONTRACTORS
    (
        "POST",
        "/api/v1/contractors/{contractor_id}/deactivate",
    ): Audience.SUPER,  # MANAGE_CONTRACTORS
    (
        "POST",
        "/api/v1/contractors/{contractor_id}/reactivate",
    ): Audience.SUPER,  # MANAGE_CONTRACTORS
    # --- dashboard ---
    ("GET", "/api/v1/dashboard/live"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- data-requests ---
    ("GET", "/api/v1/data-requests"): Audience.SUPER,  # MANAGE_DATA_REQUESTS
    ("POST", "/api/v1/data-requests"): Audience.SUPER,  # MANAGE_DATA_REQUESTS
    ("GET", "/api/v1/data-requests/{request_id}"): Audience.SUPER,  # MANAGE_DATA_REQUESTS
    ("POST", "/api/v1/data-requests/{request_id}/events"): Audience.SUPER,  # MANAGE_DATA_REQUESTS
    # --- departments ---
    ("PATCH", "/api/v1/departments/{item_id}"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/departments/{item_id}/deactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/departments/{item_id}/reactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    # --- docs ---
    ("GET", "/api/docs"): Audience.PUBLIC,
    ("GET", "/docs/oauth2-redirect"): Audience.PUBLIC,
    # --- employees ---
    ("GET", "/api/v1/employees"): Audience.ALL_ADMINS,  # VIEW_EMPLOYEES
    ("POST", "/api/v1/employees"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    ("POST", "/api/v1/employees/bulk"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    ("POST", "/api/v1/employees/import"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    ("GET", "/api/v1/employees/import/template.xlsx"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    ("GET", "/api/v1/employees/{employee_id}"): Audience.ALL_ADMINS,  # VIEW_EMPLOYEES
    ("PATCH", "/api/v1/employees/{employee_id}"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    (
        "GET",
        "/api/v1/employees/{employee_id}/convert-preview",
    ): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    (
        "DELETE",
        "/api/v1/employees/{employee_id}/convert-to-permanent",
    ): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    (
        "POST",
        "/api/v1/employees/{employee_id}/convert-to-permanent",
    ): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    ("GET", "/api/v1/employees/{employee_id}/face"): Audience.ALL_ADMINS,  # VIEW_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/employees/{employee_id}/face/consent",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/employees/{employee_id}/face/consent/withdraw",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/employees/{employee_id}/face/enrolment-sessions",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/employees/{employee_id}/face/template/delete",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    ("POST", "/api/v1/employees/{employee_id}/mark-left"): Audience.SUPER,  # MARK_EMPLOYEE_LEFT
    ("GET", "/api/v1/employees/{employee_id}/phone"): Audience.ALL_ADMINS,  # VIEW_PHONE_ACCESS
    ("PUT", "/api/v1/employees/{employee_id}/phone/access"): Audience.SUPER,  # MANAGE_PHONE_ACCESS
    (
        "PUT",
        "/api/v1/employees/{employee_id}/phone/outside-work",
    ): Audience.SUPER,  # MANAGE_PHONE_ACCESS
    (
        "POST",
        "/api/v1/employees/{employee_id}/phone/passkeys/{passkey_id}/remove",
    ): Audience.SUPER,  # MANAGE_PHONE_ACCESS
    (
        "POST",
        "/api/v1/employees/{employee_id}/phone/require-new-password",
    ): Audience.SUPER,  # MANAGE_PHONE_ACCESS
    (
        "POST",
        "/api/v1/employees/{employee_id}/phone/sign-out-all",
    ): Audience.SUPER,  # MANAGE_PHONE_ACCESS
    ("GET", "/api/v1/employees/{employee_id}/qr-cards"): Audience.ALL_ADMINS,  # VIEW_QR_CARDS
    ("POST", "/api/v1/employees/{employee_id}/qr-cards"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/employees/{employee_id}/reactivate"): Audience.SUPER,  # MARK_EMPLOYEE_LEFT
    ("GET", "/api/v1/employees/{employee_id}/shift-swaps"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/employees/{employee_id}/shift-swaps"): Audience.SUPER,  # MANAGE_SHIFT_SWAPS
    ("GET", "/api/v1/employees/{employee_id}/timeline"): Audience.ALL_ADMINS,  # VIEW_EMPLOYEES
    ("POST", "/api/v1/employees/{employee_id}/transfer"): Audience.SUPER_CORP,  # CHANGE_EMPLOYEES
    # --- exports ---
    ("GET", "/api/v1/exports/recent"): Audience.SUPER,  # EXPORT_ALL_DATA
    ("POST", "/api/v1/exports/full"): Audience.SUPER,  # EXPORT_ALL_DATA
    # --- face ---
    ("GET", "/api/v1/face/consent-texts/{version}"): Audience.ALL_ADMINS,  # VIEW_FACE_ENROLMENT
    ("GET", "/api/v1/face/enrolment-progress"): Audience.ALL_ADMINS,  # VIEW_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/face/enrolment-sessions/{session_id}/cancel",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/face/enrolment-sessions/{session_id}/finish",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    (
        "POST",
        "/api/v1/face/enrolment-sessions/{session_id}/shots",
    ): Audience.SUPER,  # MANAGE_FACE_ENROLMENT
    # --- health ---
    ("GET", "/api/v1/health"): Audience.PUBLIC,
    ("GET", "/api/v1/health/ready"): Audience.PUBLIC,
    # --- holidays ---
    ("GET", "/api/v1/holidays"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/holidays"): Audience.SUPER,  # MANAGE_HOLIDAYS
    ("POST", "/api/v1/holidays/{holiday_id}/cancel"): Audience.SUPER,  # MANAGE_HOLIDAYS
    # --- insights ---
    ("GET", "/api/v1/insights/punctuality"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- kiosk ---
    ("GET", "/api/v1/kiosk/gate-code"): Audience.DEVICE,
    ("POST", "/api/v1/kiosk/gate-code"): Audience.DEVICE,
    ("POST", "/api/v1/kiosk/heartbeat"): Audience.DEVICE,
    ("GET", "/api/v1/kiosk/me"): Audience.DEVICE,
    ("POST", "/api/v1/kiosk/register"): Audience.PUBLIC,
    ("POST", "/api/v1/kiosk/report"): Audience.DEVICE,
    ("POST", "/api/v1/kiosk/sync"): Audience.DEVICE,
    # --- kiosks ---
    ("GET", "/api/v1/kiosks"): Audience.ALL_ADMINS,  # VIEW_KIOSKS
    ("POST", "/api/v1/kiosks"): Audience.SUPER_PLANT,  # MANAGE_KIOSKS
    ("GET", "/api/v1/kiosks/status-summary"): Audience.ALL_ADMINS,  # VIEW_KIOSKS
    ("PATCH", "/api/v1/kiosks/{kiosk_id}"): Audience.SUPER_PLANT,  # MANAGE_KIOSKS
    ("GET", "/api/v1/kiosks/{kiosk_id}/health"): Audience.ALL_ADMINS,  # VIEW_KIOSKS
    ("POST", "/api/v1/kiosks/{kiosk_id}/pairing-code"): Audience.SUPER_PLANT,  # MANAGE_KIOSKS
    ("GET", "/api/v1/kiosks/{kiosk_id}/pairing-qr.svg"): Audience.SUPER_PLANT,  # MANAGE_KIOSKS
    ("POST", "/api/v1/kiosks/{kiosk_id}/revoke"): Audience.SUPER_PLANT,  # MANAGE_KIOSKS
    # --- leave ---
    ("GET", "/api/v1/leave"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/leave"): Audience.SUPER,  # MANAGE_LEAVE
    ("POST", "/api/v1/leave/{leave_id}/cancel"): Audience.SUPER,  # MANAGE_LEAVE
    # --- me ---
    ("GET", "/api/v1/me/notification-preferences"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("PUT", "/api/v1/me/notification-preferences"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- muster ---
    ("GET", "/api/v1/muster"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("GET", "/api/v1/muster.pdf"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- notices ---
    ("GET", "/api/v1/notices"): Audience.ALL_ADMINS,  # VIEW_NOTICES
    ("POST", "/api/v1/notices"): Audience.SUPER_PLANT,  # MANAGE_NOTICES
    ("PATCH", "/api/v1/notices/{notice_id}"): Audience.SUPER_PLANT,  # MANAGE_NOTICES
    ("POST", "/api/v1/notices/{notice_id}/end"): Audience.SUPER_PLANT,  # MANAGE_NOTICES
    # --- notifications ---
    ("GET", "/api/v1/notifications"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/notifications/read-all"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/notifications/test-email"): Audience.SUPER,  # EDIT_SETTINGS
    ("GET", "/api/v1/notifications/unread-count"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "POST",
        "/api/v1/notifications/{notification_id}/read",
    ): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- openapi ---
    ("GET", "/api/v1/openapi.json"): Audience.PUBLIC,
    # --- phone ---
    ("GET", "/api/v1/phone/attendance"): Audience.PHONE,
    ("POST", "/api/v1/phone/login"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/logout"): Audience.PHONE,
    ("GET", "/api/v1/phone/me"): Audience.PHONE,
    ("GET", "/api/v1/phone/notice"): Audience.PHONE,
    ("POST", "/api/v1/phone/notice/accept"): Audience.PHONE,
    ("GET", "/api/v1/phone/passkeys"): Audience.PHONE,
    ("POST", "/api/v1/phone/passkeys/login"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/passkeys/login/options"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/passkeys/register"): Audience.PHONE,
    ("POST", "/api/v1/phone/passkeys/register/options"): Audience.PHONE,
    ("DELETE", "/api/v1/phone/passkeys/{passkey_id}"): Audience.PHONE,
    ("POST", "/api/v1/phone/password"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/proof/card"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/proof/face"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/proof/face/challenge"): Audience.PUBLIC,
    ("POST", "/api/v1/phone/punch/challenge"): Audience.PHONE,
    ("POST", "/api/v1/phone/punch/early-out/confirm"): Audience.PHONE,
    ("POST", "/api/v1/phone/punch/face"): Audience.PHONE,
    ("POST", "/api/v1/phone/punch/gate-code"): Audience.PHONE,
    ("GET", "/api/v1/phone/punches/today"): Audience.PHONE,
    ("POST", "/api/v1/phone/stop"): Audience.PHONE,
    # --- plants ---
    ("GET", "/api/v1/plants"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants"): Audience.SUPER,  # MANAGE_PLANTS
    ("GET", "/api/v1/plants/{plant_id}"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("PATCH", "/api/v1/plants/{plant_id}"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("GET", "/api/v1/plants/{plant_id}/categories"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/categories"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/deactivate"): Audience.SUPER,  # MANAGE_PLANTS
    ("GET", "/api/v1/plants/{plant_id}/departments"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/departments"): Audience.SUPER,  # EDIT_PLANT_SETUP
    (
        "GET",
        "/api/v1/plants/{plant_id}/gate-poster.pdf",
    ): Audience.SUPER_PLANT,  # DOWNLOAD_GATE_POSTER
    ("GET", "/api/v1/plants/{plant_id}/geofence"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("PUT", "/api/v1/plants/{plant_id}/geofence"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("GET", "/api/v1/plants/{plant_id}/geofence/versions"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/reactivate"): Audience.SUPER,  # MANAGE_PLANTS
    ("GET", "/api/v1/plants/{plant_id}/readiness"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("GET", "/api/v1/plants/{plant_id}/shifts"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/shifts"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("GET", "/api/v1/plants/{plant_id}/weekly-off"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    ("POST", "/api/v1/plants/{plant_id}/weekly-off"): Audience.SUPER,  # EDIT_PLANT_SETUP
    # --- privacy-notice ---
    ("GET", "/api/v1/privacy-notice"): Audience.PUBLIC,
    # --- punch ---
    ("POST", "/api/v1/punch/challenge"): Audience.DEVICE,
    ("POST", "/api/v1/punch/kiosk"): Audience.DEVICE,
    ("POST", "/api/v1/punch/kiosk/code"): Audience.DEVICE,
    ("POST", "/api/v1/punch/kiosk/early-out/confirm"): Audience.DEVICE,
    # --- punch-approvals ---
    ("GET", "/api/v1/punch-approvals"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- punches ---
    ("GET", "/api/v1/punches"): Audience.ALL_ADMINS,  # VIEW_PUNCHES
    ("GET", "/api/v1/punches/export.xlsx"): Audience.ALL_ADMINS,  # EXPORT_PUNCHES
    ("GET", "/api/v1/punches/summary"): Audience.ALL_ADMINS,  # VIEW_PUNCHES
    ("GET", "/api/v1/punches/{punch_id}"): Audience.ALL_ADMINS,  # VIEW_PUNCHES
    ("GET", "/api/v1/punches/{punch_id}/compare"): Audience.SUPER,  # VIEW_SNAPSHOTS
    ("GET", "/api/v1/punches/{punch_id}/review-context"): Audience.SUPER,  # REVIEW_PUNCHES
    ("POST", "/api/v1/punches/{punch_id}/reviews"): Audience.SUPER,  # REVIEW_PUNCHES
    ("GET", "/api/v1/punches/{punch_id}/snapshot"): Audience.SUPER,  # VIEW_SNAPSHOTS
    # --- qr-cards ---
    ("GET", "/api/v1/qr-cards"): Audience.ALL_ADMINS,  # VIEW_QR_CARDS
    ("POST", "/api/v1/qr-cards/bulk"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("GET", "/api/v1/qr-cards/expiring-count"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/qr-cards/print"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("PATCH", "/api/v1/qr-cards/{card_id}"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/qr-cards/{card_id}/card.pdf"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/qr-cards/{card_id}/revoke"): Audience.SUPER,  # MANAGE_QR_CARDS
    # --- qr-test-cards ---
    ("GET", "/api/v1/qr-test-cards"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/qr-test-cards"): Audience.SUPER,  # MANAGE_QR_CARDS
    ("POST", "/api/v1/qr-test-cards/{card_id}/revoke"): Audience.SUPER,  # MANAGE_QR_CARDS
    # --- regularisations ---
    ("GET", "/api/v1/regularisations"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/regularisations"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "POST",
        "/api/v1/regularisations/batches/{batch_id}/approve-all",
    ): Audience.SUPER,  # DECIDE_CORRECTIONS
    (
        "POST",
        "/api/v1/regularisations/batches/{batch_id}/reverse",
    ): Audience.SUPER,  # DECIDE_CORRECTIONS
    ("POST", "/api/v1/regularisations/bulk"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/regularisations/bulk/preview"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("POST", "/api/v1/regularisations/preview"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    ("GET", "/api/v1/regularisations/summary"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    (
        "POST",
        "/api/v1/regularisations/{correction_id}/approve",
    ): Audience.SUPER,  # DECIDE_CORRECTIONS
    (
        "POST",
        "/api/v1/regularisations/{correction_id}/reject",
    ): Audience.SUPER,  # DECIDE_CORRECTIONS
    (
        "POST",
        "/api/v1/regularisations/{correction_id}/reverse",
    ): Audience.SUPER,  # DECIDE_CORRECTIONS
    (
        "POST",
        "/api/v1/regularisations/{correction_id}/withdraw",
    ): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- reports ---
    ("GET", "/api/v1/reports/{kind}.{file_format}"): Audience.ALL_ADMINS,  # VIEW_ATTENDANCE
    # --- reviews ---
    ("GET", "/api/v1/reviews"): Audience.SUPER,  # REVIEW_PUNCHES
    ("POST", "/api/v1/reviews/bulk-confirm"): Audience.SUPER,  # REVIEW_PUNCHES
    ("GET", "/api/v1/reviews/digest"): Audience.SUPER,  # REVIEW_PUNCHES
    ("GET", "/api/v1/reviews/summary"): Audience.SUPER,  # REVIEW_PUNCHES
    # --- search ---
    ("GET", "/api/v1/search"): Audience.ANY_ADMIN,
    # --- settings ---
    ("GET", "/api/v1/settings"): Audience.ALL_ADMINS,  # VIEW_SETTINGS
    ("PUT", "/api/v1/settings"): Audience.SUPER,  # EDIT_SETTINGS
    # --- setup ---
    ("POST", "/api/v1/setup/client-plants"): Audience.SUPER,  # MANAGE_PLANTS
    ("GET", "/api/v1/setup/status"): Audience.SUPER,  # MANAGE_PLANTS
    # --- shift-swaps ---
    ("POST", "/api/v1/shift-swaps/{swap_id}/cancel"): Audience.SUPER,  # MANAGE_SHIFT_SWAPS
    # --- shifts ---
    ("PATCH", "/api/v1/shifts/{shift_id}"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/shifts/{shift_id}/deactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("POST", "/api/v1/shifts/{shift_id}/reactivate"): Audience.SUPER,  # EDIT_PLANT_SETUP
    ("GET", "/api/v1/shifts/{shift_id}/rule-versions"): Audience.ALL_ADMINS,  # VIEW_PLANT_SETUP
    # --- users ---
    ("GET", "/api/v1/users"): Audience.SUPER,  # MANAGE_USERS
    ("POST", "/api/v1/users"): Audience.SUPER,  # MANAGE_USERS
    ("PATCH", "/api/v1/users/{user_id}"): Audience.SUPER,  # MANAGE_USERS
    ("POST", "/api/v1/users/{user_id}/deactivate"): Audience.SUPER,  # MANAGE_USERS
    ("POST", "/api/v1/users/{user_id}/force-logout"): Audience.SUPER,  # MANAGE_USERS
    ("POST", "/api/v1/users/{user_id}/reactivate"): Audience.SUPER,  # MANAGE_USERS
    ("POST", "/api/v1/users/{user_id}/reset-password"): Audience.SUPER,  # MANAGE_USERS
}
