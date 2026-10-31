"""Who may do what: the role matrix of spec §7 rule 1 (decision 0005), in one place.

Each capability lists the roles that have it and how far it reaches:
- ALL:          every plant;
- OWN_PLANT:    only the plant in the user's plant access (Plant Head);
- VIA_APPROVAL: every plant, but the change waits for a Super Admin's approval
                (Corporate Head's employee changes, the approvals inbox).
A role that is not listed has no access at all. The server always decides from the role;
the browser never chooses the approval path.
"""

import enum

from app.modules.users.models import Role


class Access(enum.Enum):
    ALL = "all"
    OWN_PLANT = "own_plant"
    VIA_APPROVAL = "via_approval"


class Capability(enum.Enum):
    MANAGE_USERS = "manage_users"
    MANAGE_PLANTS = "manage_plants"  # create, deactivate, reactivate
    VIEW_PLANT_SETUP = "view_plant_setup"  # details, geofence, departments, shifts, categories
    EDIT_PLANT_SETUP = "edit_plant_setup"
    VIEW_SETTINGS = "view_settings"
    EDIT_SETTINGS = "edit_settings"
    VIEW_KIOSKS = "view_kiosks"
    MANAGE_KIOSKS = "manage_kiosks"  # create, pairing code, rename, revoke
    VIEW_CONTRACTORS = "view_contractors"
    MANAGE_CONTRACTORS = "manage_contractors"
    VIEW_EMPLOYEES = "view_employees"
    CHANGE_EMPLOYEES = "change_employees"  # create, edit, transfer, bulk change, import
    MARK_EMPLOYEE_LEFT = "mark_employee_left"  # also reactivate
    DECIDE_CHANGE_REQUESTS = "decide_change_requests"
    VIEW_OWN_CHANGE_REQUESTS = "view_own_change_requests"
    VIEW_AUDIT = "view_audit"
    VIEW_QR_CARDS = "view_qr_cards"  # the cards list and an employee's card history (M2)
    # Issue, revoke, end, extend, bulk, test cards, print. Super Admin only (decisions 0005, 0009).
    MANAGE_QR_CARDS = "manage_qr_cards"
    VIEW_PUNCHES = "view_punches"  # the punch log, its summary and detail (M2)
    EXPORT_PUNCHES = "export_punches"  # the punch log as Excel: text only, never photos
    # Opening a punch photo, and comparing photos of one card. Super Admin only (decision 0009).
    VIEW_SNAPSHOTS = "view_snapshots"
    VIEW_NOTICES = "view_notices"  # gate notices (F-25)
    # Create, edit, end. Plant Head: own plant only, never the all-plants notices.
    MANAGE_NOTICES = "manage_notices"
    DOWNLOAD_GATE_POSTER = "download_gate_poster"  # the A4 poster next to the kiosk (F-34)
    # Face (M3): who is enrolled (yes/no, date, by whom), the progress card, the list filter.
    VIEW_FACE_ENROLMENT = "view_face_enrolment"
    # Consent, withdrawal, enrolment, duplicate override, deleting face data. Super Admin only.
    MANAGE_FACE_ENROLMENT = "manage_face_enrolment"
    # Match scores, the typed code and the claimed employee in the punch detail. Super Admin only.
    VIEW_FACE_SCORES = "view_face_scores"
    # "Needs review" (M4): confirm or not-accept a flagged punch, approve a rejected one, the
    # review reasons, the daily digest and the repeat-pattern hints. Super Admin only.
    REVIEW_PUNCHES = "review_punches"
    # M5 (spec M5 §7 rule 1). Attendance days, register, timeline, leave and holiday lists.
    VIEW_ATTENDANCE = "view_attendance"
    # Ask for a correction; the Super Admin corrects directly instead (DECIDE_CORRECTIONS).
    REQUEST_CORRECTIONS = "request_corrections"
    DECIDE_CORRECTIONS = "decide_corrections"  # approve, reject, direct correction, reverse
    MANAGE_LEAVE = "manage_leave"
    MANAGE_HOLIDAYS = "manage_holidays"
    MANAGE_SHIFT_SWAPS = "manage_shift_swaps"  # one-day shift swap (F-58), Super Admin only
    VIEW_REPORTS = "view_reports"  # Excel / PDF reports; Plant Head: own plant only
    RECOMPUTE_ATTENDANCE = "recompute_attendance"
    SHOW_DEMO_PLANTS = "show_demo_plants"  # include DEMO plants in screens and reports


SUPER_ADMIN = Role.SUPER_ADMIN
CORPORATE_HEAD = Role.CORPORATE_HEAD
PLANT_HEAD = Role.PLANT_HEAD

PERMISSIONS: dict[Capability, dict[Role, Access]] = {
    Capability.MANAGE_USERS: {SUPER_ADMIN: Access.ALL},
    Capability.MANAGE_PLANTS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_PLANT_SETUP: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.EDIT_PLANT_SETUP: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_SETTINGS: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.ALL,
    },
    Capability.EDIT_SETTINGS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_KIOSKS: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.MANAGE_KIOSKS: {SUPER_ADMIN: Access.ALL, PLANT_HEAD: Access.OWN_PLANT},
    Capability.VIEW_CONTRACTORS: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.ALL,  # one company-wide list
    },
    Capability.MANAGE_CONTRACTORS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_EMPLOYEES: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.CHANGE_EMPLOYEES: {SUPER_ADMIN: Access.ALL, CORPORATE_HEAD: Access.VIA_APPROVAL},
    Capability.MARK_EMPLOYEE_LEFT: {SUPER_ADMIN: Access.ALL},
    Capability.DECIDE_CHANGE_REQUESTS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_OWN_CHANGE_REQUESTS: {CORPORATE_HEAD: Access.ALL},
    Capability.VIEW_AUDIT: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.VIEW_QR_CARDS: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.MANAGE_QR_CARDS: {SUPER_ADMIN: Access.ALL},
    # Plant Head: punches made at a kiosk of their own plant (spec M2 §5.3).
    Capability.VIEW_PUNCHES: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.EXPORT_PUNCHES: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.VIEW_SNAPSHOTS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_NOTICES: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,  # plus the notices for all plants (read only)
    },
    Capability.MANAGE_NOTICES: {SUPER_ADMIN: Access.ALL, PLANT_HEAD: Access.OWN_PLANT},
    # Not a credential (no personal data), so a Plant Head may print it for their own plant.
    Capability.DOWNLOAD_GATE_POSTER: {SUPER_ADMIN: Access.ALL, PLANT_HEAD: Access.OWN_PLANT},
    Capability.VIEW_FACE_ENROLMENT: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.MANAGE_FACE_ENROLMENT: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_FACE_SCORES: {SUPER_ADMIN: Access.ALL},
    Capability.REVIEW_PUNCHES: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_ATTENDANCE: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.REQUEST_CORRECTIONS: {CORPORATE_HEAD: Access.ALL, PLANT_HEAD: Access.OWN_PLANT},
    Capability.DECIDE_CORRECTIONS: {SUPER_ADMIN: Access.ALL},
    Capability.MANAGE_LEAVE: {SUPER_ADMIN: Access.ALL},
    Capability.MANAGE_HOLIDAYS: {SUPER_ADMIN: Access.ALL},
    Capability.MANAGE_SHIFT_SWAPS: {SUPER_ADMIN: Access.ALL},
    Capability.VIEW_REPORTS: {
        SUPER_ADMIN: Access.ALL,
        CORPORATE_HEAD: Access.ALL,
        PLANT_HEAD: Access.OWN_PLANT,
    },
    Capability.RECOMPUTE_ATTENDANCE: {SUPER_ADMIN: Access.ALL},
    Capability.SHOW_DEMO_PLANTS: {SUPER_ADMIN: Access.ALL},
}


def access_for(role: str, capability: Capability) -> Access | None:
    """The access a role has to a capability, or None when it has none."""
    return PERMISSIONS[capability].get(Role(role))
