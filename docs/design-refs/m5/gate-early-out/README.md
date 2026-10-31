# M5 gate: early OUT dialog (mockups)

Route /attendance. Shown when a worker punches OUT before the shift end (decision 0036). Mockup only (static HTML, fake data, no person or name shown). Source: `early-out.html` (`?v=1` or `?v=2`, add `&shot` to freeze the bar). Same look as the M4 gate mockups (Steel & Signal, Inter, 4 px ink border, hard ink shadow, hazard stripe, icon + word).

PNGs: `early-out-v1-{360,768,1280}.png` (before half shift, amber) and `early-out-v2-{360,768,1280}.png` (after half shift, blue notice).

## Layout
Dimmed gate screen behind (scrim ink 72 %). Dialog card: header band (icon circle + small "Leaving early" tag + title), time rows, one plain sentence, 20 s timer (ring + bar + words), then Agree (primary) and Cancel (secondary). 360 px: card sits at the bottom, buttons stacked (Agree first, Cancel second), ring and tag hidden to keep it on one screen. 768/1280: card centred, buttons side by side.

## Texts (en-IN, i18n keys proposed)
| Key | Text |
|---|---|
| gate.earlyOut.tag | Leaving early |
| gate.earlyOut.half.title | Your half shift is not complete yet |
| gate.earlyOut.full.title | Your full shift is not over yet |
| gate.earlyOut.halfRemaining | Half shift complete in |
| gate.earlyOut.fullRemaining | Full shift ends in |
| gate.earlyOut.atTime | at {{time}} (24 h, IST) |
| gate.earlyOut.duration | {{hours}} h {{minutes}} min (under 1 h: {{minutes}} min) |
| gate.earlyOut.half.consequence | If you leave now, your day may count as short hours. |
| gate.earlyOut.full.consequence | If you leave now, your day may count as a half day. |
| gate.earlyOut.cancelsIn | Cancels in {{seconds}} s |
| gate.earlyOut.agree | Agree |
| gate.earlyOut.cancel | Cancel |

Examples shown: shift 09:00-17:00, half 4 h. Punch 11:10: half in 1 h 50 min (13:00), full in 5 h 50 min. Punch 15:25: full in 1 h 35 min (17:00). Rows and cards keep room for longer Marathi/Hindi text (wrapping, no fixed widths).

## Colours (tokens from m4/gate-a/tokens.css)
- Ink `#0e1726` text and borders (18:1 on white); muted `#4a5567` (7.5:1).
- Variant 1 warning: band and main row `#fff3d6`, text and icon `#7a4500` (about 7.3:1 on the band), row edge `#b97300`. Icon: triangle-alert.
- Variant 2 notice: band and main row `#eaeefb`, text and icon `#1a3282` (about 9.5:1), row edge `#8da0e0`. Icon: clock.
- Agree: `#1f3a93` with white text (10:1), shadow `#142a6b`. Cancel: white, 4 px ink border, ink text. Focus ring `#f5b700` 5 px.
- Colour is never the only signal: icon, title word and the amber/blue tone together.

## Sizes
- All text 24 px or more: title 28 (phone) / 36 / 42 px, durations 34-52 px bold, sentence 26-28 px, labels and timer words 24 px.
- Buttons: 72 px (phone), 92 px (tablet/PC) high, full or half width, 32-34 px label, icon 40 px. Gap 14-16 px.
- Dialog width: 100 % on phone, 760 px tablet, 900 px PC.

## 20 s timer
- Starts when the dialog opens; ring and bar drain linearly from 20 s to 0 (shown at 13 s in the mockups). The words "Cancels in N s" update each second (the ring number too).
- At 0 the dialog closes by itself like Cancel: nothing is recorded and the gate returns to scanning.
- Agree records the OUT; Cancel closes with nothing recorded. Agree is the default focus; Esc and Cancel do the same.
- Do not announce every second to screen readers: role="alertdialog" announces the title and sentence once; the countdown is aria-hidden except a polite update at 10 s and 5 s.
- prefers-reduced-motion: no drain animation; the bar steps once a second and the words carry the time.
- Sound: one short neutral chime on open (same family as the other gate notices); no sound on auto-cancel.

## States
- Loading: none (all values come with the punch check; the dialog only opens when ready).
- Error (server cannot give shift times): do not open the dialog; use the normal gate error screen.
- Component sources: none copied; plain markup and Lucide icons (ISC) already used in the app.
