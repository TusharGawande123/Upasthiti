# 0015 Removing the demo plant (2026-10-22)

After the first live demo the lead asked for everything made for it to be removed from the live
website: the demo plant, the demo worker, cards, test cards, the attendance device, punches and photos.

The screens never delete people, punches or audit rows (CLAUDE.md section 5: labour-law record
keeping). So the removal is a separate tool, `uv run python -m app.scripts.remove_demo_plant`,
and it is a deliberate, narrow exception:

- it works only on a plant whose code starts with `DEMO` (a real plant such as K134 is refused);
- without `--confirm` it only prints what it would delete; with it, the plant code must be typed again;
- everything goes in one database transaction (all or nothing), and the "never change a punch"
  protection of the `punches` table is switched off only inside it and is on again afterwards (tested);
- **the audit log is not touched** (lead's choice): its lines about the demo stay, and one new line
  `demo_data.removed` (counts only) says that the removal happened;
- test cards belong to nobody, so they are removed only with `--include-test-cards` (they are listed first);
- the photo files in the Supabase bucket are deleted after the commit; any key that fails is printed.

How the lead runs it (from `backend/`, on the laptop, values typed in the terminal and removed again):
set `DATABASE_URL` (Supabase session pooler string), `STORAGE_BACKEND=supabase`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`; run once without `--confirm` to see the list; run again with `--confirm`.
