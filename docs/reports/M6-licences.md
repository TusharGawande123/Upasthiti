# M6 licence check of the dependencies

Run on 2026-11-06 (follow-up of plan slice 2.6, AC-M6-18; this was skipped in the M6 PR). Rule of the project: every
dependency is free (CLAUDE.md section 5). The test is cost, so this list shows that no package needs a fee or a
paid tier. It is not legal advice.

Method (run-only tools, nothing was added to the project): the licence field of every installed Python package
(`importlib.metadata`, the development environment of `backend/`, so it includes the test-only packages) and
`npx license-checker --production` in `frontend/` (the packages that end up in the website).

## Backend (Python, 82 packages)
| Licence | Packages |
|---|---|
| MIT, MIT-0, MIT-CMU | 42 |
| BSD-2-Clause, BSD-3-Clause, other BSD forms | 22 (includes numpy, whose bundle also lists 0BSD, Zlib, CC0-1.0) |
| Apache-2.0 (also written Apache Software License) | 12 (includes `opencv-python-headless`, `uharfbuzz`, `pyOpenSSL`; `cryptography` is Apache-2.0 or BSD) |
| LGPL-3.0-only | 3: `fpdf2` (PDF files), `psycopg` and `psycopg-binary` (database driver). Free to use; we use them as installed libraries and do not change them |
| MPL-2.0 | 1: `hypothesis` (tests only) |
| PSF-2.0, ISC | 2: `typing_extensions`, `shellingham` |
| Unknown or paid | none |

## Frontend (npm, packages in the production bundle)
| Licence | Packages |
|---|---|
| MIT | 166 |
| ISC | 14 |
| Apache-2.0 | 5 |
| BSD-3-Clause, BSD-2-Clause, 0BSD | 6 |
| OFL-1.1 (fonts) | 2: `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` |
| Unlicense, (MIT OR CC0-1.0) | 3: `robust-predicates` (two versions), `type-fest` |
| EDL-1.0 or EPL-1.0 | 2: `jsts`, `@turf/jsts` (the check tool printed "Custom"; the package field says `(EDL-1.0 OR EPL-1.0)`; EDL is a BSD-3 licence) |
| BSD-3-Clause | `splaytree-ts` (the tool printed `BSD*`; the package field says BSD-3-Clause) |
| `UNLICENSED` | `upasthiti-frontend` itself (our own private package, not a dependency) |

## Fonts and other files
Noto Sans Devanagari (gate poster), SIL OFL 1.1, licence text kept next to the font files under
`backend/app/modules/printing/fonts/`.

## Result
Every package is free of cost. Nothing needs a paid tier or a licence fee. The three LGPL packages and the two
jsts packages are the only ones that are not MIT, BSD or Apache; they are free to use as libraries.
