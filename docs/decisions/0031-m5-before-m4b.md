# 0031 – M5 (attendance processing, dashboards, reports) is built before M4b (phone punching)

Date: 2026-10-29 · Decided by: Tushar Gawande (lead), passed on by Anuradha, who now leads the day-to-day
work on M4's end and M5 · Status: Accepted.

- Order of the roadmap changes: M5 first, then M4b. The M4b spec and plan are not started before M5 is merged.
- Why: the client sees value sooner from registers, a live headcount and reports built on the gate
  punches that already exist; phone punching stays optional per employee.
- Effect on M5: the processing reads punches only through `punches/counting.py`. When M4b adds phone
  punches they will use the same `punches` table and rules, so M5 needs no change for them.
