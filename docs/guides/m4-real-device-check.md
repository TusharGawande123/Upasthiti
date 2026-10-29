# M4 real-device check (gate phone and gate PC)

**One request for Tushar:** please run this on the **gate phone** and on the **gate PC** (the real
attendance devices at the plant) and send me the results (the table at the end is enough). It needs
about 2 hours, most of it waiting for the one hour offline. A computer test cannot do this: it needs a
real GPS, a real camera and a real network cut.

The live site: https://upasthiti-chi.vercel.app (the gate page is `/attendance`). The server of M4 is
already live (version `509f8cf`).

## Before you start (once)
- Log in to the admin site as Super Admin. Pick the plant of the device you test.
- You need: **one employee who punches with a QR card** (a test card does not count: use a real
  employee with a card) and **one employee enrolled for face** whose employee code you know. Print the
  QR card, or open it on another screen.
- A shift of that plant must be running during step 7.
- Use a device that is already paired, or pair it first (menu "Attendance devices", "Add device").
- Take a note of the time you start each step.

## The checklist (do it on the phone, then on the PC)

1. **Install the page for offline.** Open `/attendance` on the device **while it is online**, wait until
   the gate screen shows the camera, then keep it open for one minute.
   *Expect:* the gate works normally. (The device now holds the gate page for offline use.)
   On a phone: also use "Add to home screen" and open the gate from that icon.

2. **Location.**
   a. Stand inside the plant fence. *Expect:* the top bar says "Location good (± … m)" and a card scan
      is accepted.
   b. Walk outside the fence, or switch the device's location off. *Expect:* the screen "This
      attendance device needs its location", with a short reason. When it says "outside the fence" it
      draws the **"Why paused?" sketch** (fence, margin and the device's position). No punch is possible.
   c. Go back inside. *Expect:* the gate resumes by itself, without a tap.

3. **One hour offline.** Switch the device's internet off (flight mode with Wi-Fi off, or unplug the
   network). *Expect:* the top bar says "No internet – punches are saved". Now, **in this order**:
   a. Show the **QR card**, look at the camera, tap "I'm ready". *Expect:* **SAVED – "Saved – will be
      confirmed"**, with **no name and no IN or OUT**.
   b. Tap "Punch with face". *Expect:* the device asks you to **type your employee code** first, then
      to turn your head (the device chooses the turn). *Expect:* **SAVED** again, no name, no IN/OUT.
   c. The footer says "2 punches waiting since hh:mm" and the top bar "2 saved".
   d. **Leave the device offline for one hour**, then go to step 4. (Do not close the gate page.)

4. **Back online.** Switch the internet on again. *Expect:* within about a minute the gate says
   "Sending saved punches…" and then **"All punches sent ✓ hh:mm"**; the waiting count disappears.
   On the admin site, "Punch log":
   - both punches are there, with the **time you made them** (about one hour ago) and the mark
     "Saved offline";
   - a punch that was refused or flagged shows the reason (for example "Already punched" if you scanned
     the same card twice within two minutes);
   - flagged punches (edge of the fence, time not proven, travel, two devices) are listed in **"Needs
     review"**. Open one: the map, the time proof and the history are there.
   Note any punch that **should not** have been refused or flagged.

5. **Reload while offline (AC-21).** Switch the internet off again, then **reload the gate page**
   (pull down or press F5, or close it and open it again from the icon).
   *Expect:* the gate page **still opens** and shows the camera, with the offline chip. Then switch the
   internet on.

6. **Switch off a device that has waiting punches.**
   a. Make one more offline punch (internet off, one card scan, **SAVED**).
   b. On the admin site open "Attendance devices" and press "Revoke" for this device.
      *Expect:* the dialog warns "1 punch is still waiting on this attendance device. If you switch it
      off now, it is lost. Wait until it shows 0 if you can." Cancel once, then revoke with a reason.
   c. Switch the device's internet on. *Expect:* the gate shows **"Switched off"** and "1 saved punch
      could not be sent. Please visit the plant office."
   d. Pair the device again with a new code ("Type a new code") so it works again.

7. **Offline alert on the admin site.** During a running shift, switch the device's internet off and
   wait **10 minutes**. *Expect:* on the admin site the top bar shows the red badge "1 attendance device
   offline", and an amber banner names the device. "Hide" hides the banner for this browser. The devices
   page shows "Offline since hh:mm". Switch the internet on: the badge goes away within a minute.

## What to send me
Fill the table (one line per step, per device). "OK" or what you saw instead, plus a photo of any
screen that looked wrong. Also note the device (model, Android or Windows version, browser).

| Step | Gate phone | Gate PC | Notes |
|---|---|---|---|
| 1 install and open offline | | | |
| 2a location good | | | |
| 2b needs-location screen and sketch | | | |
| 2c resumes by itself | | | |
| 3 card punch offline: SAVED, no name | | | |
| 3 face punch offline: code, turn, SAVED | | | |
| 4 sent by itself, "All punches sent" | | | |
| 4 both in the punch log with the right time | | | |
| 4 flagged ones in "Needs review" | | | |
| 5 reload while offline opens (AC-21) | | | |
| 6 revoke warning and "Switched off" with the count | | | |
| 7 badge and banner after 10 minutes | | | |

When the results come in, they are written into `docs/decisions/0030-m4-real-device-results.md`.
