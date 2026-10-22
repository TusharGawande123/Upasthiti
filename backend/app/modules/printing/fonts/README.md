# Fonts for the PDFs (ID cards, test cards, gate poster)

fpdf2 needs TrueType files, so the PDFs embed these instead of the website's web font. Inter
covers Indian names written in Latin letters (including marks such as ā or ṭ).

| File | Source | Licence |
|---|---|---|
| `Inter-Regular.ttf`, `Inter-Bold.ttf` | Inter 4.1 release, `extras/ttf/` (https://github.com/rsms/inter/releases/tag/v4.1) | SIL Open Font License 1.1 (`OFL.txt`), free |

The licence file must stay next to the fonts. Only the letters used are embedded in each PDF
(subsetting), so the PDFs stay small.
