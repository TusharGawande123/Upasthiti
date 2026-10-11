# 0000 – Design direction

Date: 2026-10-11 · Decided by: Tushar Gawande (project lead) · Status: Accepted

## Decision
- **Kiosk:** Direction A "Forge". Split screen: live camera on the left (never
  covered), solid result panel on the right. Safety-yellow scan frame, white
  panels and near-black text for sunlight.
- **Theme: LIGHT** (updated 2026-10-11 by Tushar): the admin dashboard and
  the whole website use a light theme. The look must be modern and premium,
  not dark. (Earlier note "Forge dark admin" is replaced; a dark toggle may
  come later as an extra.)
- **When to design:** each screen is designed during its own milestone (in
  the spec/plan step), not all up front.
- **Fonts:** **Anek Latin** for UI text and **Geist Mono** for times,
  headcounts and codes (both SIL OFL 1.1, self-hosted). **Anek Devanagari** is the matching
  fallback when Marathi/Hindi are switched on later.
- **Language:** English first (en-IN); Marathi/Hindi optional later.

## Visual reference
Design canvas with both directions (kiosk, kiosk result states, admin):
https://claude.ai/artifact/WqBk1FfhFe6xiK3rN4t4to (private to the owner; share
from its Share menu). Colours and rules: docs/design-refs/inspiration.md
sections 2–3.

## Why
- Split kiosk keeps the queue moving at shift change and reads best in daylight.
- The dark admin dashboard has a control-room feel that suits a factory and impresses examiners.
- Anek (Ek Type, Mumbai) looks modern and friendly. Its family also covers
  Devanagari, so translations will match later.
