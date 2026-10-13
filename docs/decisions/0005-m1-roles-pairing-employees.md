# 0005 – M1 decisions: roles, kiosk pairing, employee data

Date: 2026-10-13 · Decided by: Tushar Gawande (project lead), after talking to Sheet Shapers ·
Status: Accepted (with the M1 spec)
Details: [docs/specs/M1-foundation.md](../specs/M1-foundation.md) §7 rules 1, 5, 10, 11.
Changes on approval: docs/SRS.md, docs/architecture.md, CLAUDE.md (before the M1 PR).

## Decisions

1. **Final role matrix** (replaces SRS §3.2):
   - **Super Admin** does everything: users, plants, geofences, departments, shifts,
     categories, settings, contractors, employees (create, edit, transfer, bulk, import,
     mark as left, reactivate), QR cards, punch review, regularisation approval, phone punch
     permission.
   - **Corporate Head** creates, edits, transfers, bulk-changes and imports permanent **and**
     temporary employees of all plants, but every such change waits for a Super Admin's
     approval (approvals inbox). Reads everything else; may request regularisations.
   - **Plant Head** reads their own plant (details, geofence, shifts, employees,
     contractors), manages their own plant's kiosks (create, pairing code, revoke) and may
     request regularisations. No employee changes.
   - Only the Super Admin marks employees as left and expires or revokes QR cards, always by
     hand. "Delete employee" means "mark as left"; nothing is deleted (Labour Code records).
2. **No plant network allow-list.** SRS FR-03 and anti-proxy rule 3 (network) are dropped.
   Reason: phones must punch without joining the plant Wi-Fi, and the client IP behind
   Vercel can be faked, so it was a weak proof anyway.
3. **Kiosk pairing, one rule for phones and PCs:** an accurate location (≤ 50 m, a setting)
   inside the geofence pairs at once; an accurate location outside is refused; a device
   without a usable location (most PCs, the client says) waits for a **Super Admin's
   approval**, with no time limit. Known risk: such a kiosk has only its device key as proof;
   accepted, and reviewed again in the M4 spec.
4. **Overtime rate is per employee** (₹ per OT hour), not per shift (client). Shifts keep
   "overtime starts after N minutes".
5. **Employee codes** are Sheet Shapers' existing codes, typed in by the admin; the system
   suggests none. Format kept flexible (1–12 letters, digits, `-`, `/`) until samples arrive.
6. **Employee category is required**; the Super Admin keeps a category list per plant
   (defaults Staff, Worker, Operator, Helper).
7. **Contractors** are one company-wide list; they supply operators and helpers.
8. **Login** by username + password or email + password; username required, email optional.
   Only the three admin roles log in; employees never do.
