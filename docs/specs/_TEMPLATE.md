# M<n> – <Milestone name>: Specification

Status: Draft | In review | Approved · Author: spec-writer · Date: YYYY-MM-DD
Related: docs/SRS.md (FR-xx), docs/architecture.md, CLAUDE.md §6–§7

> Write in simple, clear English. No application code. Kiosk is the only punch channel.

## 1. Problem and goal
What problem this milestone solves, for whom, and what "done" looks like in 3–5 lines.

## 2. Scope
- **In scope:** the features of this milestone (from CLAUDE.md §7 and SRS FR-xx).
- **Out of scope:** what we will NOT do now (including future-scope items from CLAUDE.md §1).

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | HR | … | … | FR-xx |

## 4. Screens and UX (light, modern, premium; English first)
For each screen, cover:
- purpose and layout;
- states: empty, loading, error, success;
- key components;
- accessibility notes;
- kiosk rules if relevant: big text, zero-tap, colour plus icon plus word, honest offline message.

Link the design reference (canvas or Figma frame) once it exists.

## 5. API contract
Conventions: REST under `/api/v1`, JSON, error format `{ "error": { "code", "message", "details" } }`,
pagination `?page=&page_size=`.

| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/… | HR | `{ … }` | `{ … }` | `…` |

## 6. Data model changes
New or changed tables and columns, with types, keys, indexes and constraints, and the Alembic
migration name. Remember:
- UTC timestamps;
- `numeric(12,2)` for money;
- no hard deletes of punch, attendance or audit rows.

## 7. Business rules
Numbered rules, written precisely. Examples: anti-proxy checks in order, attendance and
salary calculations. State which values are settings and their defaults.

## 8. Security, privacy and compliance
- Role checks per endpoint.
- Which actions write audit logs.
- Personal or face data touched, with consent, encryption and retention.
- DPDP / IT Act / Labour Code notes. Ask the compliance-auditor if relevant.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | Kiosk/user message (English, i18n key) |
|---|---|---|---|

## 10. Acceptance criteria (Given / When / Then)
- **AC-1** Given …, when …, then …

## 11. Test plan
Which tests cover which ACs:
- unit (pytest / Vitest);
- API (pytest + httpx);
- end-to-end (Playwright);
- manual checks.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
Think like a product owner. List every idea that would make **this milestone or the whole
project** better: features, screens, checks, UX polish, security, performance, or a better
library or approach than the one planned.

**Approval rule:** nothing in this section is built until the project lead approves it.
- Ask the lead about each suggestion directly in chat as a simple choice; don't leave
  questions only in this file.
- Mark each row as Approved / Rejected / Later.
- Copy approved items into the scope (§2), the acceptance criteria (§10) and
  docs/decisions/.

| # | Suggestion | Why it helps | Effort S/M/L | Risk | Status (Pending / Approved / Rejected / Later) |
|---|---|---|---|---|---|
| S-1 | … | … | … | … | Pending |

## 13. Dependencies to add
| Package | Version | Licence | Reason |
|---|---|---|---|

## 14. Open questions for the team
1. …
