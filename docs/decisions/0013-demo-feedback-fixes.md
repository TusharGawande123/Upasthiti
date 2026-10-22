# 0013 Changes after the first live demo (2026-10-22)

The lead tried the live site with a phone and a laptop. Changes made:

- **Photo timing.** The photo used to be taken 0.7 s after the card was read, so a worker who showed
  a card from a laptop screen got a photo of the laptop. Now the screen says "Card read. Get ready
  for your photo." with a countdown (setting `kiosk_photo_ready_seconds`, default 20 s, 5 to 60),
  a button "I'm ready: take my photo" and a "Cancel" button. When the time is over the photo is
  taken by itself if the camera is ready; if not, the punch is cancelled.
- **Front and back camera.** On a device with more than one camera a button switches the camera.
  The camera that reads cards and the camera used for the photo are chosen separately and the
  choice is kept on the device (localStorage, per task). Default is the front camera for both
  (right for a tablet or PC fixed at the gate); a phone user taps once to use the back camera for
  cards. The camera picture is mirrored only for the front camera.
- **Bigger camera on a phone.** The camera square is full width above the text on a phone.
- **"Kiosk" is not a word workers or clients know.** Everything people read now says "attendance
  device" (menu: "Attendance devices"; gate screen: "Gate attendance"). The code, the database
  and the API keep the name kiosk.
- **Gate page address.** `/attendance` (the old `/kiosk` still works and keeps the pairing code).
  The pairing QR now points to `/attendance`. The setup guide tells how to add it to the phone's
  home screen from the browser menu.
- **Politer words.** "Please see the plant office" is now "Please visit the plant office".
