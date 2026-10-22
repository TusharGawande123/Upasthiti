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
3. Open the website address and add `/kiosk`, **or scan the QR code** from the admin screen:
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
- Location must stay allowed after pairing too: from M4 every punch is checked against the
  geofence.

## Punching with a QR card (from M2)

After pairing, the kiosk shows the camera picture, the server time and **Show your ID card to
the camera**. Nobody has to tap anything: scanning starts by itself.

1. The worker holds the card in front of the camera (10–30 cm).
2. **Card read. Look at the camera**: the kiosk takes one small photo of the worker. It stops
   card sharing; the photo is encrypted and deleted after the retention period (60 days by
   default, a setting).
3. The answer comes from the server: **IN** (green) or **OUT** (blue) with the name, or a
   reason in red, such as **Already IN** or a card that no longer works. A rejected card never
   shows the name. The line **For the admin: CODE** tells the admin what happened.

Workers can punch only at **their own plant's** gate, and only if their punch method is QR.

## Make the device a good gate kiosk

**Full screen and sound.** Tap the screen once after the page opens (**Tap once to turn on
sound and full screen**). Browsers allow sound only after a tap. Without it the kiosk still
works, silently.

**Windows PC (Chrome or Edge).** Make a desktop shortcut that opens the kiosk full screen
and allows sound without a tap. Right-click the desktop › New › Shortcut, and use one of
these targets (with your site address):

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://<site>/kiosk --autoplay-policy=no-user-gesture-required
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://<site>/kiosk --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
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

## Every morning: the TEST card

The Super Admin prints a **TEST card** (QR cards › Test cards) for each gate. The guard or the
Plant Head shows it to the kiosk at the start of the day. **KIOSK OK** with the server time
means the camera, the internet connection and the server all work. A TEST card records no
attendance and takes no photo.

## The gate poster

Plants › the plant › **Download gate poster (A4 PDF)** gives an A4 page with how to punch and the photo
privacy notice (how long photos are kept). Print it and fix it next to the kiosk.

## If the kiosk shows a problem while punching

| The screen says | What to do |
|---|---|
| Camera is blocked | Tap the padlock next to the address, set Camera to Allow, press **Try again** |
| No camera found | Check the camera cable; close other apps that use the camera |
| No internet | Check the Wi-Fi or mobile data. Punches are not saved while offline (offline saving comes in M4) |
| The server is starting. Please wait… | The free server was asleep; it wakes in under a minute. Keep the card ready |
| This is not an Upasthiti ID card | Use the card printed by the plant office |
| Too dark | Switch on the gate light |
