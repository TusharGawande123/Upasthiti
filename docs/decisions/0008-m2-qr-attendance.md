# 0008 – M2 decisions: QR cards and the kiosk punch

Date: 2026-10-19 · Decided by: Tushar Gawande (project lead) · Status: Accepted (with the M2 spec)
Details: [docs/specs/M2-qr-attendance.md](../specs/M2-qr-attendance.md) §14.
Changes on approval: docs/SRS.md (FR-14, §5.b, §8), docs/architecture.md (§3, §7), CLAUDE.md,
`.env.example`. Amends decision 0005 (who prints cards) and M1 spec §7 rule 10 (plant check).

## Decisions

1. **A QR card works at any plant's kiosk**, not only at the employee's own plant. The punch is
   recorded at the kiosk's plant. Card sharing is still checked through the snapshot, the
   cool-down and (from M4) the impossible-travel rule.
2. **No plant name on the card.** A transferred worker keeps the same card.
3. **Default card validity: 6 months** (a setting; the Super Admin can change it at issue).
4. **Any employee with an active card may punch by QR**, also one whose punch method is face
   (a fallback when face recognition fails). A snapshot is always taken.
5. **Card PDFs:** the Super Admin and the Plant Head (own plant's employees only) may print or
   download them; each download is audited. Issuing, revoking, expiring and extending cards
   stay with the Super Admin only (decision 0005).
6. **Snapshots:** 320 px JPEG; a punch without a usable snapshot is rejected (`SNAPSHOT_MISSING`).
   The Super Admin sees all snapshots, the Plant Head only those of their own plant; every
   view is audited. Not shown on the kiosk result screen (name + code only).
7. **IN/OUT:** the server toggles from the last accepted punch; an IN older than 20 hours counts
   as a forgotten OUT. Cool-down 2 minutes (`COOLDOWN_ACTIVE`); a second scan within 30 minutes
   of an IN is refused (`OUT_TOO_SOON`). Both are settings.
8. **Kiosk voice** (F-1) uses only the device's own voices and never says the employee's name.
9. **Gate notices** (F-25): the Super Admin for any or all plants, the Plant Head for their own plant.
10. **Card size:** CR80 single card, plus A4 sheets of 10.
11. **No audit row per punch:** the `punches` table is append-only itself.
12. **Supabase Storage** is reached with the service key, kept only in Render's environment;
    Supabase's Data API stays switched off.

## Notes
- Role matrix (decision 0005) widened: the Plant Head gets `PRINT_QR_CARDS` for their own plant's
  employees and test cards. "Issue and print cards after an import" (F-38) is offered to the
  Super Admin only.
- Pulled forward in part: S-25 storage meter (from F-14), F-36 kiosk online badge (from F-3 / FR-24).
- Follow-ups for later specs: M3 decides whether a face employee punching by card is reported or
  limited; M4 adds a flag for "IN at one plant, OUT at another" (the plants are 1–3 km apart, so
  impossible travel cannot catch it); M5 decides which plant a visiting worker's day counts for.
- **Card content (confirmed 2026-10-19):** the card prints the issue date, not the end date, so
  extending a card never needs a reprint. The end date lives only in the system.
