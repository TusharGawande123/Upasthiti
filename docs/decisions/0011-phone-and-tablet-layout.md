# 0011 Phone and tablet layout (2026-10-22)

The lead wants the website to run well on any device. A check on 2026-10-22 (390 px phone,
768 px tablet, 1366 px laptop) found:

- Below 1024 px the left menu was hidden and there was no other menu: pages could only be
  reached through the search box. A menu button with a slide-out menu now exists
  (`app/layouts/mobile-menu.tsx`).
- Every admin page scrolled sideways on a phone and a tablet (top bar too wide). Fixed.
- The kiosk pairing screen was 580 px wide on a 390 px phone held upright (six fixed 78 px digit
  boxes, 56 px heading). The digit boxes now shrink, and the pairing, scanning and result
  screens fit a phone. Phones held sideways and tablets were already fine.
- Tables keep a readable width (40 rem) and scroll inside their card; a hidden screen-reader
  label inside a table header made the whole page wider (the table wrapper is now `relative`).

Rule (CLAUDE.md section 5): no sideways page scroll at 360 px and 768 px, every page reachable
from the phone menu. `e2e/tests/responsive.spec.ts` checks it in CI.

Not covered yet: touch targets under 32 px on a phone (checkboxes, small buttons on the audit
log and employees list), the real camera on iPhone/Safari, and a real gate phone (the real-device
pairing check in decision 0007 stays open).
