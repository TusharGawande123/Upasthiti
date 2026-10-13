# Setting up a gate kiosk

For the plant office and the admin. A kiosk is a phone, tablet or PC with a camera that
stands at a plant gate. This page is about **pairing** (the first setup). Pairing needs
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
- Attendance punching itself arrives in a later update (M2). Until then the kiosk only shows
  that it is paired and online.
