# Fonts for the PDFs (ID cards, test cards, gate poster)

fpdf2 needs TrueType files, so the PDFs embed these instead of the website's web font. Inter
covers Indian names written in Latin letters (including marks such as ā or ṭ).

| File | Source | Licence |
|---|---|---|
| `Inter-Regular.ttf`, `Inter-Bold.ttf` | Inter 4.1 release, `extras/ttf/` (https://github.com/rsms/inter/releases/tag/v4.1) | SIL Open Font License 1.1 (`OFL.txt`), free |
| `NotoSansDevanagari-Regular.ttf`, `NotoSansDevanagari-Bold.ttf` | Noto Sans Devanagari, unhinted static TTF from https://github.com/notofonts/devanagari (build `fonts/NotoSansDevanagari/unhinted/ttf/`) | SIL Open Font License 1.1 (`OFL-NotoSansDevanagari.txt`), free |

Noto Sans Devanagari is used only by the Marathi and Hindi gate poster (M6 F-99). It has no Latin
letters, so the poster takes Latin text (plant names, IN, OUT) from Inter. The poster shapes the
Devanagari letters with `uharfbuzz` (Apache-2.0) through fpdf2.

The licence files must stay next to the fonts. Only the letters used are embedded in each PDF
(subsetting), so the PDFs stay small. The four font files together are under 1.2 MB.
