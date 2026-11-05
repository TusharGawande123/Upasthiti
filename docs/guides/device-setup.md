# Setting up a gate kiosk

For the plant office and the admin. A kiosk is a phone, tablet or PC with a camera that
stands at a plant gate. This page covers **pairing** (the first setup) and **daily use** at the
gate (from M2). Pairing needs
**location switched on**; there is no other way and no approval route (decision 0005).

## Before you start (admin)

1. The plant must exist and have a **geofence** (Plants › the plant › Geofence). Without it
   the system cannot check that the device is at the gate, and it will not make a code.
2. You must be the Super Admin, or the Plant Head of this plant.

## On the admin screen

1. Open **Kiosks › Add kiosk**. Choose the plant, give the device a name (for example
   "Main gate tablet") and press **Make pairing code**.
2. The screen shows a 6-digit code, a QR code and a 10-minute countdown. The code works
   **once**. If it runs out, press **Make a new code**.

## On the gate device

1. Use **Chrome or Edge** (the latest version). The page needs a secure (https) address.
2. Switch **Location** on in the phone or Windows settings. On a PC, Wi-Fi must be switched
   on too (it does not have to be connected to a network); that is how a PC finds its place.
3. Open the website address and add `/attendance`, **or scan the QR code** from the admin screen:
   the code is then filled in for you.
4. Press **Allow** when the browser asks for the location.
5. Keep the device **at the gate** until it says **Paired**. Pairing takes up to 20 seconds
   while the device finds its location.
6. Put the browser in full screen and keep the screen on.

When it works, the device says **Paired to <plant>** and shows the server time in IST. The
admin screen shows the kiosk as **Active**.

## If something goes wrong

| The screen says | What it means | What to do |
|---|---|---|
| This code is not right | A digit is wrong | Type it again |
| Code expired | More than 10 minutes passed | Admin: **Make a new code**; type the new one |
| Too many tries | The code was typed wrong too often | Admin: **Make a new code** |
| Location is off | Location is off or was refused | Switch Location on, press Allow, **Try again** |
| Location not accurate enough | The device cannot find its place well enough (more than 50 m off) | Switch Wi-Fi on, move near a window or the open gate, **Try again** |
| Not at the plant | The device is outside the plant's geofence | Take it to the gate. Already there? Ask the admin to check the geofence on the map |
| Browser not supported | The browser is old or the page is not https | Use the latest Chrome or Edge |
| Switched off | The admin revoked this kiosk | Admin adds it again as a new kiosk |

Every problem screen shows a small line **For the admin: CODE**. Tell the admin this code
if you need help; it is also in the audit log.

## Good to know

- The device keeps its own secret key. It cannot be copied out of the browser, and every
  request is signed with it, so a copied kiosk id does not work on another device.
- Clearing the browser's site data on the device removes the key. The device then has to be
  paired again (the admin adds it as a new kiosk).
- The 50 m accuracy limit and the margin around the geofence are settings the Super Admin
  can change (Settings).
- Location must stay allowed after pairing too: since M4 **every punch** is checked against the
  geofence. See "Location on every punch" below.

## Punching with a QR card (from M2)

After pairing, the kiosk shows the camera picture, the server time and **Show your ID card to
the camera**. Nobody has to tap anything: scanning starts by itself.

1. The worker holds the card in front of the camera (10–30 cm).
2. **Card read. Get ready for your photo**: the worker looks at the camera and taps **I'm ready**
   (or waits 20 seconds). If needed, the worker can switch between the front and the back camera
   with the camera button, or tap **Cancel**. The device then takes one small photo. It stops
   card sharing; the photo is encrypted and deleted after the retention period (60 days by
   default, a setting).
3. The answer comes from the server: **IN** (green) or **OUT** (blue) with the name, or a
   reason in red, such as **Already IN** or a card that no longer works. A rejected card never
   shows the name. The line **For the admin: CODE** tells the admin what happened.

Workers can punch only at **their own plant's** gate, and only if their punch method is QR.

## Punching with the face (from M3)

Permanent employees punch with their face. Card scanning stays exactly as above and needs no tap.
A face punch starts with **one tap** on the big **Punch with face** button under (or beside) the
camera picture.

### Set up the gate for faces

Face punches need a clear picture of the face. Do this once when you mount the device:

1. **Light on the face.** The face must be lit from the front. Put a light above or beside the
   device, pointing at the place where people stand.
2. **No strong light behind the person.** Do not mount the device facing a window, an open
   gate or the sun. A bright background makes the face dark, and the device says "The picture is
   too dark or blurry".
3. **Camera at face height**, about **1.5 m** from the floor. A camera that is too low or too
   high sees the chin or the top of the head.
4. **Distance.** People should stand close enough that the face fills a good part of the oval.
   If a worker is too far, the screen says "Come closer". (The server needs a face at least 80
   pixels wide in a 640 pixel picture; this is a setting. The distance in metres depends on
   the camera, so test with a real person and mark the spot on the floor.)
5. **One person at a time.** Mark a spot on the floor, or fix a small rail, so only one person
   stands in front of the camera. If two faces of about the same size are seen, the punch is not
   accepted ("Only one person, please").
6. **Keep the camera glass clean.** A dusty or greasy glass makes the picture blurry.
7. **Poster.** Print the gate poster again after M3 (Plants › the plant › **Download gate poster
   (A4 PDF)**). It now shows both ways (card and face) and the privacy notice. Fix it **next to
   the device, at eye level**, where people wait.

### What the worker sees

1. The worker taps **Punch with face**. The camera picture fills the screen with an **oval**.
   The text says: "Look at the camera. Keep your face inside the oval."
2. Short hints can appear: "Come closer", "Move a little back", "Only one person, please",
   "More light needed".
3. When the face is good, a big **arrow** appears with the words **"Turn your head to your LEFT"**
   (or RIGHT). The direction is chosen at random by the server. The worker turns their head
   that way, then "Now look straight again."
4. The screen says "Checking…". The answer takes about 1 to 2 seconds when the server is awake:
   **IN** (green) or **OUT** (blue) with the name.
5. If the system is not sure who the person is, a **code pad** opens: "Type your employee code."
   The worker types their code (digits and letters; the keys "EMP-" and similar are one tap).
   There are 2 tries. If it still does not work, the screen says "Please visit the plant office."
6. A **Cancel** button is always shown. After 30 seconds without progress the screen goes back
   to normal by itself.

Whenever a punch is refused, or the code pad was needed, one small photo is kept for the
retention period (60 days by default) so the Super Admin can check what happened. An accepted
face punch keeps **no** photo.

### When the face button is missing or not available

| What you see | What it means | What to do |
|---|---|---|
| No **Punch with face** button | No employee of this plant has enrolled a face yet | Normal. The Super Admin enrols faces in the admin website (employee page › Enrol face). Card punches still work |
| Button greyed: "Face punch is starting…" | The server was asleep or has just restarted; the face models load for a short time | Wait one minute. Card punches work meanwhile |
| Button greyed: "Face punch is not available right now" | The face part of the server is switched off or failed to start | Tell the admin. Check `https://<site>/api/v1/health`: `face.state` should say `ready`. If it says `failed`, see the runbook (deploy/README.md, "Face recognition"). Card punches work meanwhile |
| "Many people are punching. Please try again in a moment." | The server is busy (shift change) | Wait a few seconds and press **Try again** |
| "Please visit the plant office." | The face and the code were not accepted | The worker goes to the plant office. The Super Admin can check the photo in the punch log |

The camera used for the face photo can be changed with the camera button (front camera is the
default), the same as for card photos.

**Keep the device locked.** Keep the browser in full-screen kiosk mode (see below). A device
that anyone can open is a risk: someone could try to feed it prepared pictures.

## Make the device a good gate kiosk

**Full screen and sound.** Tap the screen once after the page opens (**Tap once to turn on
sound and full screen**). Browsers allow sound only after a tap. Without it the kiosk still
works, silently.

**Windows PC (Chrome or Edge).** Make a desktop shortcut that opens the kiosk full screen
and allows sound without a tap. Right-click the desktop › New › Shortcut, and use one of
these targets (with your site address):

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://<site>/attendance --autoplay-policy=no-user-gesture-required
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://<site>/attendance --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
```

Put the shortcut in the Startup folder (Win + R › `shell:startup`) so the kiosk opens after a
restart. To leave kiosk mode, press Alt + F4.

**Android phone or tablet (Chrome).**
- Settings › Security › **App pinning** (or "Pin windows") on; open the kiosk in Chrome and
  pin it, so the screen stays on the kiosk page.
- Keep the device on its charger.

**Camera and location.** The first time, the browser asks for the camera: press **Allow**.
If it was refused, tap the padlock next to the address, set **Camera** and **Location** to
**Allow**, and press **Try again**.

**Keep the screen on.** The kiosk asks the device to keep its screen on while the page is
open, but the power settings must allow it too:
- Windows: Settings › System › Power › Screen and sleep: **Never** when plugged in.
- Android: Settings › Display › Screen timeout: the longest; with Developer options on, also
  **Stay awake** (screen never sleeps while charging).

**Camera position.** Aim the camera only at the person standing at the kiosk: at face height,
with no view of the road, the queue behind or other workstations. Photos of people who are not
punching have no reason to exist. Fix the gate poster (see below) next to the kiosk.

**Light.** Workers must be visible in the photo. If the gate is too dark the kiosk says
**Too dark. Please switch on the gate light.**

**Updates.** The kiosk checks for a new version every 5 minutes and reloads itself only after
30 seconds with nobody punching, never in the middle of a punch.

**After every update of the website (deploy).** Open each gate page once (or wait until it has
reloaded itself), so the attendance device installs the new version. An attendance device that
still runs a very old page can have its punches refused until it reloads.

## Location on every punch (from M4)

The attendance device must know where it is for **every** punch, not only for pairing. The
server checks each punch against the plant's geofence.

1. Keep **Location** switched on and allowed for the website, all day.
2. **On a PC, keep Wi-Fi switched ON**, even if the PC uses a cable for the internet. Windows
   finds the PC's position from the Wi-Fi networks nearby; it does not need to connect to them.
3. Look at the location chip in the top bar of the gate page:
   - **Location good (±12 m)** (green): punching works.
   - **Location weak (±140 m)** (amber) or **No location** (red): the device is waiting.
   - **Last location (offline)**: see "When the internet is down" below.
4. If there is no good location for about 10 seconds, the screen says **This attendance device
   needs its location** and punching is paused. One line says why (location blocked, switched
   off, signal too weak, or not at the plant gate). A small **Why paused?** drawing shows the
   fence and where the device thinks it is. The screen goes away by itself when the location is
   good again; nobody has to tap.
5. What to do: allow Location in the browser (padlock next to the address), switch Wi-Fi on,
   move the device nearer a window or the open gate. If the drawing shows the device outside the
   fence while it is at the gate, ask the Super Admin to check the geofence.

A punch made at the very edge of the fence (inside the allowed margin) is accepted as usual. The
Super Admin sees it marked for checking in **Needs review**.

## Add the gate page to the home screen (phone or tablet)

1. Open the gate page (`/attendance`) in Chrome.
2. Open the Chrome menu (three dots) and choose **Add to Home screen** (or **Install app**).
3. Keep the name **Gate attendance** and confirm.
4. From now on, open the gate page from this icon. It opens in full screen.

## Storage on the device (from M4)

When the internet is down, punches are saved in the browser's storage on the device.

- At start the gate page asks the browser to **keep its storage** (not clear it when space is
  short). The Super Admin sees the answer in the device's details on the **Attendance devices**
  page; "the browser may clear it" means the browser did not promise this.
- **Storage self-check:** the gate page saves punches without internet **only when there is
  enough free storage** (room for the full queue, 200 MB by default, plus 50 MB). If there is
  not, the device details show **Offline saving off: not enough storage**. Free up space on the
  device (delete unused apps, photos or downloads), then reload the gate page.
- Do not clear the browser's site data: that also removes the device key and any saved punches.

## When the internet is down (from M4)

The attendance device keeps working for card and face punches.

1. The top bar shows **No internet – punches are saved**.
2. A card punch has the same steps as usual. A face punch first asks the worker to **type the
   employee code**, then to look at the camera and turn the head.
3. The screen shows **SAVED – Saved – will be confirmed**. It shows no name and no IN/OUT,
   because the server has not checked the punch yet.
4. The saved punches are locked so that only the server can open them. They are deleted from
   the device once they are sent.
5. If the device has no new location, it uses its **last good location from the same session**
   of the gate page (chip: **Last location (offline)**). The Super Admin sees these punches marked
   for checking. After a reload or power cut without internet there is no last location, so the
   device waits for a new good location.
6. The footer shows the guard what is waiting, for example **12 punches waiting since 08:05**,
   or **All punches sent ✓ 09:02** when nothing waits.
7. When the internet is back, the device sends the saved punches by itself within a few
   minutes. The server checks each one and decides IN or OUT.
8. If the page is reloaded (or the device restarts) while there is no internet, the gate page
   still opens, as long as it was opened once with internet before.
9. Limits: about **2,000 punches** or **200 MB** (settings). When the device is full, the screen
   says **NOT SAVED** and the worker must visit the plant office.

Workers are not told later what happened to a saved punch. The plant office sees refused ones
in the punch log.

## Before you revoke an attendance device (from M4)

A revoked device deletes its saved punches at once, without sending them.

1. On the **Attendance devices** page, press **Revoke** for the device.
2. Read the dialog. If it says **N punches are still waiting on this attendance device**, cancel
   and wait until the device shows 0 waiting (bring its internet back first).
3. Revoke only then. A **stolen** device must be revoked at once, even with punches waiting; the
   plant office corrects those days later.

## Every morning: the TEST card

The Super Admin prints a **TEST card** (QR cards › Test cards) for each gate. The guard or the
Plant Head shows it to the kiosk at the start of the day. **KIOSK OK** with the server time
means the camera, the internet connection and the server all work. A TEST card records no
attendance and takes no photo.

## The gate poster

Plants › the plant › **Download gate poster (A4 PDF)** gives an A4 page with how to punch (card and,
from M3, face) and the photo privacy notice (how long photos are kept). Print it and fix it next to
the kiosk. It also prints the address of the public privacy page (`/privacy`) as text.

## If the kiosk shows a problem while punching

| The screen says | What to do |
|---|---|
| Camera is blocked | Tap the padlock next to the address, set Camera to Allow, press **Try again** |
| No camera found | Check the camera cable; close other apps that use the camera |
| No internet – punches are saved | Punches are saved and sent later (see "When the internet is down"). Check the Wi-Fi or mobile data |
| No internet. Your punch was NOT saved. | Offline saving is not possible yet: it is not set up on the server, or the device has had no contact with the server since the page opened. Check the internet; tell the admin |
| NOT SAVED: This attendance device cannot save punches without internet | Not enough free storage on the device (see "Storage on the device"). Check the internet; free up space |
| This attendance device needs its location | See "Location on every punch" |
| NOT SAVED: This attendance device cannot save more punches | The device is full of saved punches. Bring the internet back so they are sent |
| The server is starting. Please wait… | The free server was asleep; it wakes in under a minute. Keep the card ready |
| This is not an Upasthiti ID card | Use the card printed by the plant office |
| Too dark | Switch on the gate light |
