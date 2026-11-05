# Guides

All guides are Markdown in git. PDFs are made at release time and are **not committed**.
Simple English. People-facing text says "attendance device", never "kiosk".

| Guide | For | What it covers |
|---|---|---|
| `user-manual.en.md`, `user-manual.mr.md`, `user-manual.hi.md` | Super Admin, Corporate Head, Plant Head | Task steps for each role (English, Marathi, Hindi); screenshots are placeholders |
| `worker-guide.en.md`, `worker-guide.mr.md`, `worker-guide.hi.md` | Workers | One A4 page: how to punch with face or QR card, what to do when refused, the phone option |
| `kiosk-setup.md` | The person who mounts the gate device | Hardware, full screen, pairing, location, offline, status messages (the file name keeps the old code name) |
| `runbook.md` | The client's IT person | Start and stop, keys, backup and restore, data requests, client IP setting, headers, breach template, checks |
| `deployment-findings.md` | The later deployment session | Facts and checklists for moving to the client's own server (no deployment steps) |
| `face-privacy-handover.md` | IT person, HR, Super Admin | Face data, consent, data requests, incident steps |
| `m6-manual-checklist.md` | Team, person visiting the plant | Real-device and real-world checks MC-1 to MC-12 and older open items |
| `m4-real-device-check.md` | Team | The exact 7 steps of the offline check (used by MC-6) |
| `proxy-samples/` | IT person | nginx and Caddy samples with the security headers |

Related: `docs/compliance/m6-recommended-answers.md` (compliance guidance, not legal advice),
`docs/report/design.md` and `docs/report/testing.md` (report chapters).

## Make the PDFs (at release)
1. In `e2e/` run `npm install` and `npx playwright install chromium` (once).
2. From the repository root run `node scripts/make-guide-pdfs.mjs`.
3. The PDFs appear in `guides-pdf/` (or the folder given with `--out`). Do not commit them.
4. Open each PDF. Check that each worker guide is **one A4 page** and that Marathi and Hindi letters are whole.
   Devanagari needs a font on the computer (Noto Sans Devanagari or Nirmala UI).
