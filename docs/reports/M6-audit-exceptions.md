# M6 dependency audit: results and exceptions

Run on 2026-11-05 (plan slice 2.6, AC-M6-18). Rule: no High or Critical item stays open unless it is listed here
with reason and date, signed off by the lead.

## Backend (`uvx pip-audit` on the locked set from `uv export`)

No known vulnerabilities found. Nothing to list.

## Frontend (`npm audit` in `frontend/`)

No High or Critical item. Six items (2 low, 4 moderate), all one chain of build-time packages:
`vite-plugin-pwa` -> `workbox-build` -> `@rollup/plugin-node-resolve` / `glob` -> `deepmerge`, `minimatch`.

| Package | Severity | Advisory | Why accepted | Until |
|---|---|---|---|---|
| deepmerge (via workbox-build) | low | GHSA-gcqx-w48m-w2h4 (prototype poisoning in `mergeObject`) | Runs only inside the Workbox build step on the developer or CI machine, on our own config. It is not in the browser bundle and not on the server. | The next `vite-plugin-pwa` release that moves to a fixed `workbox-build`. |
| @rollup/plugin-node-resolve (via workbox-build) | low | follows deepmerge | Same as above. | Same. |
| glob (via workbox-build) | moderate | GHSA-3g3m-2fjr-6pw4 (abort signal) | Build-time only; no untrusted input; we never abort a glob. | Same. |
| minimatch (via workbox-build) | moderate | GHSA-g3hv-75wg-m249 (DoS with crafted patterns) | Build-time only; the patterns are ours. | Same. |
| workbox-build, vite-plugin-pwa | moderate | the chain above | `npm audit fix --force` would install `workbox-build@7.3.0`, an older major that breaks `vite-plugin-pwa` 2.0.0 and the gate's offline service worker. Not worth the risk for a build-only finding. | Same. |

Sign-off of the lead: accepted by Tushar Gawande on 2026-11-06 (in chat). The six items are build-time only; the fix would need
an older major version of `vite-plugin-pwa` that would break the gate's service worker.

## End-to-end tests (`npm audit` in `e2e/`)

Found 0 vulnerabilities.

## Licences

Not re-run in this slice (run-only item of the plan); the licence of every package is stated when it is added.
