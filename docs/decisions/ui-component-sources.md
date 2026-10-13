# UI component sources

Every UI component copied into the repo (CLAUDE.md §10) gets one row here. Only free sources
are allowed; paid kits (Magic UI Pro, Motion+, Skiper Premium, paid templates) are not.

| Component | Source URL | Licence / cost | Date | Files in repo | Changes we made |
|---|---|---|---|---|---|
| Button, Input/Textarea, Label, Card, Badge, Skeleton, Table, Dialog, Alert, Select (written by hand in the shadcn/ui style) | https://ui.shadcn.com (patterns), https://www.radix-ui.com (Dialog and menu behaviour) | MIT, free | 2026-10-13 | `frontend/src/components/ui/*.tsx` | Our design tokens (Steel & Signal), icon + word status badges, native `<select>`, translated close button |
| Field (label + control + hint + error row) | own component | – | 2026-10-13 | `frontend/src/components/ui/field.tsx` | – |
| User menu, sonner toasts | https://www.radix-ui.com/primitives/docs/components/dropdown-menu, https://sonner.emilkowal.ski | MIT, free | 2026-10-13 | `frontend/src/app/layouts/user-menu.tsx`, `frontend/src/main.tsx` | Our tokens; toasts bottom-right |
| Inter variable font (self-hosted) | https://github.com/rsms/inter via `@fontsource-variable/inter` | SIL OFL 1.1, free | 2026-10-13 | `frontend/src/styles.css` (import) | – |
