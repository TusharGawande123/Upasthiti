# M6 manual checklist: real devices and real places

For the team and the person who visits the plant. A computer test cannot do these items. They need a real
camera, real GPS, a real printer, a real phone or a real network cut. Spec: `docs/specs/M6-testing-security-docs.md`
section 14.2 (items MC-1 to MC-12), acceptance criterion AC-M6-37.

## Rules for every item

1. Use **fake or consenting people only**. Never put a real face, a real name or a real employee code in a
   photo you add to the repository. The repository is public.
2. Use a **DEMO plant** (code starts with DEMO) for practice. Use the real plant only for the items that say so.
3. Write down for each item: the device (model, Android or Windows version, browser), who did it, the date, and the
   result: **OK**, or what you saw instead.
4. An item that fails becomes a small `fix:` pull request. Keep the first result and add the retest result.
5. Items that depend on the final address or on HTTPS wait for the final server (marked **Final server**).
6. Say "attendance device" in anything you write for staff. The word "kiosk" is only a code name.

## The result table (one per item and device)

| ID | Device | Owner | Date | Result | Notes |
|---|---|---|---|---|---|
| MC-1 | | | | | |

Copy this table for every item below. The full list for the report is at the end (section "Result template").

---

## MC-1. Pair the real attendance devices (M1)

**Devices:** gate phone, a laptop, the gate PC. **Place:** at the gate of the real plant. **Time:** 20 minutes each.
**Why a machine cannot:** real GPS accuracy and real browsers. **Needs:** the plant has a geofence (MC-2).

1. Log in to the admin website as Super Admin (or as the Plant Head of this plant).
2. Open the menu **Attendance devices**. Press **Add device**. Choose the plant and give a name, for example
   "Main gate phone". Press **Make pairing code**.
3. On the device, open Chrome or Edge (latest version). Switch **Location** on in the phone or Windows settings.
   On a PC, switch **Wi-Fi** on too (it does not need to connect).
4. Open the website address and add `/attendance`, or scan the QR code on the admin screen.
5. Type the 6-digit code. Press **Allow** when the browser asks for location. Stand at the gate and wait up to
   20 seconds.
6. Look at the location line at the top of the gate page. It must say "Location good" with 50 m or better.
7. Write down the model, system, browser and the accuracy shown.
8. On the admin screen, open the device and check the **readiness card**.

**Expected result.** The device says **Paired**. The admin screen shows the device as **Active** and the
readiness card is green.
**Photograph.** The gate screen with the location line (no faces). The readiness card.

## MC-2. Draw the real geofence of each of the 7 plants (M1, decision 0007 open item)

**Device:** a phone with GPS and a laptop. **Place:** on site, walking the boundary. **Time:** 30 minutes per plant.
**Final server:** no (the live site can be used).

1. Open the menu **Plants**, open the plant, then **Geofence**.
2. Press **Show my location**. Walk along the boundary of the plant. Switch to **satellite view** to check the
   walls and gates.
3. Draw the polygon so the area covers the whole plant and the gate, with a margin that includes the place where
   the attendance device stands.
4. Save.
5. Stand **inside**, then **at the edge**, then **outside**. At each place make a test punch with the TEST card.
6. Read the result of each test punch in the **Punch log**.

**Expected result.** Inside: accepted. Edge: accepted and marked for checking. Outside: refused.
**Plants done:** tick each plant in the result template.

## MC-3. Gate phone cameras (M2)

**Device:** the gate phone with a laminated card. **Place:** at the gate. **Time:** 30 minutes.

1. Open `/attendance` on the gate phone.
2. Hold a laminated card at 30 cm and at 50 cm, in shade and in direct light. Note which distances work.
3. Check that the **rear camera** reads the card.
4. After "Card read", check that the photo step uses the **front camera**. Press the camera button to switch the
   cameras. Check that the choice is remembered.
5. Note every failure: glare, blur, "Too dark. Please switch on the gate light."

**Expected result.** The card is read first time at 30 cm in shade. Glare cases are written down with the hint
shown. The photo is taken with the front camera.

## MC-4. Print a card and the poster (M2, M5)

**Device:** the real card printer (CR80) and the office printer (A4). **Place:** plant office. **Time:** 30 minutes.

1. Open the menu **QR cards**. Print a **test card** on the real card printer (CR80 size).
2. Scan the printed card with the gate phone.
3. Open **Plants**, the plant, **Download gate poster (A4 PDF)**. Print it on the office printer.
4. Check that it is one page and readable from 1 metre.
5. If the poster is available in Marathi and Hindi, print those too and ask a reader to check the Devanagari letters.

**Expected result.** The scan works first time. The poster is one page and readable. Devanagari letters are
whole, with no broken marks.

## MC-5. Face at the real gate (M3)

**Device:** the gate device. **People:** two staff who gave consent. **Place:** at the gate. **Time:** half a day.

1. The Super Admin enrols two consenting staff (employee page, **Enrol face**, five poses, consent first).
2. Each person punches IN and OUT in morning, noon and evening light.
3. Try with glasses, then with a helmet.
4. Note any false reject (a real person refused) and any strange accept.
5. Change a face setting only together with the lead.

**Expected result.** Normal light: accepted in about 2 seconds. Written notes for glasses and helmet. No other
person is accepted as one of the two.
**Photograph.** The gate screen only, never a face.

## MC-6. One hour offline at the gate (M4)

**Devices:** the gate phone and the gate PC. **Time:** about 2 hours, mostly waiting. Follow the 7 steps of
`docs/guides/m4-real-device-check.md` exactly. They are already numbered and exact. Summary:

1. Install the page for offline (open `/attendance` online for one minute; on a phone use "Add to home screen").
2. Location: inside the fence good, outside shows the needs-location screen and the "Why paused?" sketch, back
   inside it resumes by itself.
3. One hour offline: card punch and face punch are both "SAVED" with no name and no IN or OUT.
4. Back online: "All punches sent", both punches in the **Punch log** with the right time and the mark
   "Saved offline"; flagged ones appear in **Needs review**.
5. Reload while offline: the gate page still opens (M4 AC-21).
6. Revoke a device with a waiting punch: the dialog warns; the gate shows "Switched off" with the count.
7. Offline for 10 minutes in a running shift: the admin top bar shows the red badge and the amber banner.

**Expected result.** Every "Expect" line of that file. Results go into `docs/decisions/0030-m4-real-device-results.md`
(its table is the one to fill).

## MC-7. Real Android phone with a passkey (M4b)

**Device:** an Android phone with a fingerprint or screen lock, and a second phone. **Place:** anywhere with
internet. **Time:** 20 minutes. **Final server:** yes (passkeys are tied to the address).

1. The Super Admin switches **Phone attendance** on for a DEMO employee.
2. On the phone open `/phone`. Sign in with employee code and password.
3. Choose **Add a passkey on this phone**. Confirm with the fingerprint or screen lock.
4. Sign out. Sign in with the passkey.
5. On a second phone sign in with the same employee. Go back to the first phone and try an action.

**Expected result.** The passkey works. The first phone is signed out when the second signs in (one phone at a time).

## MC-8. Phone punch outdoors and indoors (M4b)

**Device:** a phone. **Place:** inside the plant building, outside the plant, and about 3 km away. **Time:** 1 hour.

1. Punch inside the plant building. Note the accuracy and whether it is refused as weak.
2. Punch outside near the gate. When the signal is weak the text must ask the person to move to an open place.
3. The Super Admin switches **Outside work allowed** on for this employee.
4. Punch about 3 km away.
5. Open **Needs review** on the admin site.

**Expected result.** The far punch is accepted, tagged "Outside plant", and listed in **Needs review**. With
"Outside work allowed" off, the same far punch is refused.

## MC-9. Phone scans the gate code (M4b)

**Devices:** an attendance device showing the changing code, and a worker's phone. **Place:** the gate. **Time:** 30 minutes.

1. The attendance device shows the changing code (it changes every 30 seconds).
2. A temporary worker with phone attendance switched on scans it with the phone at 1 m and at 2 m, in sun and in shade.
3. Note failures.

**Expected result.** Accepted at 1 m in shade. The photo (selfie) is kept like a card punch. Failures and
distances are written down.

## MC-10. Reports on the real programs (M5, M5c)

**Device:** an office PC with Excel and a PDF viewer. **Time:** 45 minutes.

1. Open the menu **Reports**. Download all 7 reports as Excel and as PDF.
2. Open the menu **Monthly register**. Download one range register (Excel and PDF) and the print sheet of one
   employee.
3. Open each file in Excel (not only a script) and in a PDF viewer.
4. Check column widths, signs, totals, and that Devanagari names, if any, show correctly.
5. Check that no cell starting with `=` is run as a formula.

**Expected result.** All files open without a repair message. Numbers equal the screen.

## MC-11. iPhone with Safari (M4b, optional)

**Device:** an iPhone. **Time:** 30 minutes.

1. Open `/phone` in Safari. Sign in. Punch.
2. Note every difference: camera permission, passkey, location.

**Expected result.** A short list of what differs. It is information, not a pass or fail.

## MC-12. Real tablet or phone layout at the gate (M2, decision 0011)

**Device:** the gate device in its holder. **Place:** at the gate, sun and shade. **Time:** 1 hour.

1. Mount the device as in `docs/guides/device-setup.md` (the attendance device setup guide).
2. Check that the text is easy to read at arm's length.
3. Check the screen in direct sun and note whether the brightness is enough.
4. Leave the page open for 30 minutes without touching it. Check the screen did not sleep (screen wake lock).

**Expected result.** Text readable at arm's length. The screen stays on for 30 minutes.

---

## Other real-device items that are still open from M1 to M4

| ID | Origin | What | Steps | Final server |
|---|---|---|---|---|
| OP-1 | M1 AC-28, AC-36 | The deployed site works: login, headers, the pairing page | Open the deployed address on a phone and a PC. Log in. Open `/attendance`. Run `scripts/check-headers.sh` (local targets only; for the live address use the browser's developer tools and compare with the table in the runbook) | Yes |
| OP-2 | M2 AC-40 | Live load test outside working hours | Run the Locust file of `backend/loadtest/README.md` against the **final server** only, never the free tier live site. Write the median, p95 and failures | Yes |
| OP-3 | M4b AC-58 second half | CSP violations count on the real address | Open every `/phone` page on a phone with the browser console open. Count "Content Security Policy" errors | Yes |
| OP-4 | M4 decision 0028 | Open points A to E of decision 0028: expired card renewed a day late (A), backdating inside 72 hours (B), consent v2 for offline (C), approved punch shown as "Unknown" (D) | These are decisions, not checks. Write the lead's answer next to each in the results file | No |
| OP-5 | M3 | Accuracy on the client's real gate light | Part of MC-5. Do not use employee faces for accuracy tests | No |

## Result template (for `docs/decisions/0039-m6-manual-results.md`)

Copy this into the decision file after the checks are done. Style: `0030-m4-real-device-results.md`.

```text
# 0039 - M6: manual check results

Date opened: <date> - Run by: <names> - Status: Open | Done

Devices tested (model, Android or Windows version, browser): <fill in>

## Results
| ID | Device | Owner | Date | Result (OK or what was seen) | Retest result | Notes |
|---|---|---|---|---|---|---|
| MC-1 | gate phone | | | | | |
| MC-1 | laptop | | | | | |
| MC-1 | gate PC | | | | | |
| MC-2 | plant 1 .. 7 (one line each) | | | | | |
| MC-3 | gate phone | | | | | |
| MC-4 | card printer / office printer | | | | | |
| MC-5 | gate device | | | | | |
| MC-6 | gate phone | | | | | |
| MC-6 | gate PC | | | | | |
| MC-7 | Android phone | | | | | |
| MC-8 | phone | | | | | |
| MC-9 | gate + phone | | | | | |
| MC-10 | office PC | | | | | |
| MC-11 | iPhone (optional) | | | | | |
| MC-12 | gate device | | | | | |
| OP-1 to OP-5 | | | | | | |

## Failures and fixes
Each failure gets one line here and a small `fix:` pull request.

## Items that wait (owner and date, needed to merge M6)
| ID | Waiting for | Owner | Planned date |
|---|---|---|---|
```
