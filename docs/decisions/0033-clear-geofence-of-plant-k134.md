# 0033 – One-time removal of the test geofence of plant K134

Date: 2026-10-30 · Asked by: Tushar Gawande (lead) · Status: Accepted, **one exception, not a new habit**.

## Why
During the real-device check of M4 a test fence was drawn on the REAL plant K134 (see decision 0032).
The lead does not want any fence there until the real one is drawn on site. The Plants screen can only
replace a fence with a new version, never take it away, because every punch points at the version it was
judged against.

## What
- New tool `uv run python -m app.scripts.clear_geofence --plant-code K134` (add `--confirm` to clear;
  the plant code is typed again).
- **Nothing is deleted.** Every saved version stays; only the "current" mark is removed, and one audit
  line `geofence.clear` is written (plant, old version and shape).
- Without a current fence no attendance device of the plant can pair or punch (`GEOFENCE_NOT_SET`), so the
  tool refuses while the plant still has a device that is not switched off. Switch the test devices off
  first (decision 0032 already removes `plant1` and `plant2`).
- Drawing a fence later on the Plants screen adds a new current version as usual.
- Tests: `backend/tests/test_clear_geofence.py` (versions stay, audit line, no fence, working device,
  unknown plant).

## What does not change
No screen or API can clear a fence. The tool never runs by itself. CLAUDE.md section 9 gets one line for
it in the next milestone's CLAUDE.md update (not edited outside a milestone PR).
