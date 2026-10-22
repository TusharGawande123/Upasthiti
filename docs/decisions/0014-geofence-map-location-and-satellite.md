# 0014 Geofence map: "Show my location" and a satellite view (2026-10-22)

The lead drew a geofence in the first live demo and had to look up his position in Google Maps by
hand. The map on the plant's Geofence tab now has:

- **Show my location**: one click finds this device (browser location, high accuracy), shows a
  blue dot with a circle for the accuracy ("You are here (about 18 m)") and moves the map there.
  The dot keeps following while the admin walks; a second click stops it. The map is moved only
  once, so drawing is not disturbed. It needs https and the browser's location permission.
- **Map / Satellite** switch (top right). The choice is remembered on the device. The satellite
  pictures are Esri World Imagery tiles (`server.arcgisonline.com`), with Esri's credit shown on the
  map. They need no key and no account.
- Names for the four drawing tools (polygon, circle, edit, remove) so screen readers and the
  accessibility scan accept them (they were nameless before).

Licence note: Esri lets the public World Imagery tiles be viewed with credit; it is meant for light
use (an admin drawing a geofence a few times), not for a product that serves maps to many people.
That is our use. If Esri ever blocks it or the client prefers another source, the map still works
on OpenStreetMap; replace `SATELLITE_URL` in `geofence-map.tsx` with another free source.
