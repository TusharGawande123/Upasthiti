# 0008 – M2 decisions: QR cards and the kiosk punch

Date: 2026-10-19, revised 2026-10-20 · Answered in chat by: Anuradha (team member) · Status: Accepted
for the items below; the items marked "Pending Tushar" are not decided (see 0009).
Details: [docs/specs/M2-qr-attendance.md](../specs/M2-qr-attendance.md) §14.
Changes on approval: docs/SRS.md (FR-14, §5.b, §8 "Duplicate punch" row), docs/architecture.md
(§3, §7), CLAUDE.md, `.env.example`.

Correction (2026-10-20): the first version of this file named Tushar Gawande (project lead) as the
person who answered. The answers came from Anuradha. Where an answer conflicted with an earlier
decision or a client answer, the earlier decision is back in force until Tushar decides
([0009](0009-m2-spec-audit.md)).

## Decisions (inside M2, confirmed by Anuradha)

1. **Default card validity: 2 months** (a setting; the Super Admin can change it at issue). Changed
   from 6 months by Anuradha on 2026-10-20 (her own M2 decision, type A in 0009). The card
   expires by itself on its end date; the Super Admin can extend or end it by hand at any time.
2. **The card prints the issue date, not the end date**, so extending a card never needs a reprint.
3. **Snapshots:** 320 px JPEG; a punch without a usable snapshot is rejected (`SNAPSHOT_MISSING`);
   every view is audited. Not shown on the kiosk result screen (name + code only).
4. **IN/OUT:** the server toggles from the last accepted punch; an IN older than 20 hours counts
   as a forgotten OUT. Cool-down 2 minutes (`COOLDOWN_ACTIVE`); a second scan within 30 minutes
   of an IN is refused (`OUT_TOO_SOON`). Both are settings.
5. **Kiosk voice** (F-1) uses only the device's own voices and never says the employee's name.
6. **Gate notices** (F-25): the Super Admin for any or all plants, the Plant Head for their own plant.
7. **Card size:** CR80 single card, plus A4 sheets of 10.
8. **No audit row per punch:** the `punches` table is append-only itself (architecture §3 is updated).
9. **Supabase Storage** is reached with the service key, kept only in Render's environment;
   Supabase's Data API stays switched off.
10. **QR payload without dates** (`UPS1.<key id>.<serial>.<signature>`), so a card can be extended
    without reprinting.

## Pending Tushar (earlier decision is back in force)
These answers were given on 2026-10-19 but conflict with earlier decisions. Details, the earlier
file and the recommendation are in [0009](0009-m2-spec-audit.md).

| # | Answer given | Back to (earlier decision) |
|---|---|---|
| 1 | A card works at any plant | Own current plant only (M1 §7 rule 10, SRS §8) |
| 3 | No plant printed on the card | Plant printed (SRS FR-14) |
| 12 | Plant Head may print cards | Super Admin only (0005, CLAUDE.md §1) |
| 11 | Plant Head may view snapshots | Super Admin only (M1 §7 rule 1, SRS FR-20/FR-27) |
| 14 | Any employee may punch with a card | Only employees whose punch method is QR (CLAUDE.md §1, SRS FR-07/FR-11) |
| – | One "Tap to start" after each page load | Detection starts by itself, zero taps (SRS FR-16) |
| – | S-25 usage meter, F-36 online badge in M2 | "Later" (accepted-extras: F-14, F-3) |
