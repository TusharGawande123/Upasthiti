# UI component sources

Every UI component copied into the repo (CLAUDE.md §10) gets one row here. Only free sources
are allowed; paid kits (Magic UI Pro, Motion+, Skiper Premium, paid templates) are not.

| Component | Source URL | Licence / cost | Date | Files in repo | Changes we made |
|---|---|---|---|---|---|
| Button, Input/Textarea, Label, Card, Badge, Skeleton, Table, Dialog, Alert, Select (written by hand in the shadcn/ui style) | https://ui.shadcn.com (patterns), https://www.radix-ui.com (Dialog and menu behaviour) | MIT, free | 2026-10-13 | `frontend/src/components/ui/*.tsx` | Our design tokens (Steel & Signal), icon + word status badges, native `<select>`, translated close button |
| Field (label + control + hint + error row) | own component | – | 2026-10-13 | `frontend/src/components/ui/field.tsx` | – |
| User menu, sonner toasts | https://www.radix-ui.com/primitives/docs/components/dropdown-menu, https://sonner.emilkowal.ski | MIT, free | 2026-10-13 | `frontend/src/app/layouts/user-menu.tsx`, `frontend/src/main.tsx` | Our tokens; toasts bottom-right |
| Inter variable font (self-hosted) | https://github.com/rsms/inter via `@fontsource-variable/inter` | SIL OFL 1.1, free | 2026-10-13 | `frontend/src/styles.css` (import) | – |
| Tabs (plant detail) | https://ui.shadcn.com/docs/components/tabs (Radix Tabs) | MIT, free | 2026-10-13 | `frontend/src/components/ui/tabs.tsx` | Our tokens, underline style |
| Map with draw tools (geofence editor) | Leaflet 1.9 https://leafletjs.com · Leaflet-Geoman **free** https://github.com/geoman-io/leaflet-geoman · Turf https://turfjs.org (`area`, `kinks`, `buffer`, `circle`) | BSD-2-Clause · MIT · MIT, free (not Geoman Pro) | 2026-10-13 | `frontend/src/features/plants/geofence-map.tsx`, `geofence-geometry.ts` | One shape only; dashed margin outline from Turf; loaded on demand |
| Map tiles | OpenStreetMap standard tiles https://www.openstreetmap.org/copyright | ODbL data, attribution shown on the map | 2026-10-13 | `frontend/src/features/plants/geofence-map.tsx` | Light use only (admin drawing); never for kiosks |
| Kiosk pairing screen (digit boxes, keypad, safety stripe, error screens) | own components, designed in `docs/design-refs/m1/gate-bc/` | – | 2026-10-13 | `frontend/src/kiosk/kiosk-pairing-page.tsx` | Darker status colours in `.kiosk-theme` (7:1 contrast) |
| Device storage for the kiosk key | Dexie https://dexie.org (IndexedDB wrapper) | Apache-2.0, free | 2026-10-13 | `frontend/src/kiosk/device-store.ts` | – |
