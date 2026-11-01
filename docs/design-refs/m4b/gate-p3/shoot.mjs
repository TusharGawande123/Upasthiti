// Takes the PNG screenshots of the M4b gate P3 mockups (docs only, not app code).
// Run: node docs/design-refs/m4b/gate-p3/shoot.mjs [page-prefix ...]   (uses Playwright from e2e/node_modules; do not run the e2e tests)
// Every state is rendered at 360 x 800, 768 x 1024 and 1280 x 800. Dialogs, side sheets, the bell, the phone menu and the
// bulk bar are shot as viewport only; other states as full page. Checks: no sideways page scroll, no script errors.
// Afterwards run: python docs/design-refs/m4b/gate-p3/reduce-png.py   (palette reduction, keeps every PNG small)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../../e2e/package.json"));
const { chromium } = require("@playwright/test");

const SIZES = [[360, 800], [768, 1024], [1280, 800]];
const VIEWPORT_ONLY = /^(dialog|detail|bell|menu|toast|selected|bulk)/;

const SCREENS = [
  ["01-employee-phone", "01-employee", [
    "default", "phone-only", "outside-no-end", "outside-ended", "two-phones", "from-alert", "off", "qr-employee", "no-password", "locked",
    "new-password", "no-phones", "left", "history-open", "loading", "error", "corporate-head", "plant-head", "plant-head-off",
    "dialog-enable", "dialog-disable", "dialog-outside-on", "dialog-outside-on-filled", "dialog-outside-error-date", "dialog-outside-edit",
    "dialog-outside-off", "dialog-reason-error", "dialog-saving", "dialog-sign-out-all", "dialog-new-password", "dialog-passkey-remove",
    "dialog-conflict", "dialog-server-error", "toast-signed-out", "menu-open"]],
  ["02-employees-list", "02-employees", ["default", "filter-on", "filter-off", "filter-empty", "loading", "error", "corporate-head", "plant-head", "menu-open"]],
  ["03-punch-log", "03-punch-log", [
    "default", "filter-phone", "filter-outside", "filter-device", "filter-empty", "loading", "error", "corporate-head", "plant-head",
    "detail-inside", "detail-outside", "detail-outside-satellite", "detail-outside-ch", "detail-other-plant", "detail-gate-code", "detail-code-expired", "detail-refused-outside",
    "detail-ph", "export", "menu-open"]],
  ["04-needs-review", "04-review", [
    "default", "phone-filter", "phone-selected", "phone-all-selected", "phone-limit", "dialog-bulk", "dialog-bulk-saving", "dialog-bulk-error", "result-partial", "result-ok",
    "phone-rejected", "detail-outside", "detail-not-clean", "phone-empty", "loading", "error", "menu-open"]],
  ["05-settings", "05-settings", ["default", "changed", "range-error", "cross-check-error", "gate-cross-check-error", "save-reason", "corporate-head", "plant-head", "loading", "error", "menu-open"]],
  ["06-dashboard", "06-dashboard", ["default", "plant-k134", "zero", "plant-head", "corporate-head", "loading", "error", "menu-open"]],
  ["07-cards-ending", "07-cards-ending", ["default", "phone-only", "empty", "loading", "error", "menu-open"]],
  ["08-notifications", "08-notifications", ["bell-open", "page-default", "page-filtered", "page-read", "corporate-head", "plant-head", "menu-open"]],
  ["09-audit-log", "09-audit", [
    "default", "filter-employee", "filter-system", "filter-empty", "loading", "error", "corporate-head", "plant-head",
    "detail-self-stop", "detail-passkey-login", "detail-bulk-confirm", "detail-system-off", "detail-outside-on", "detail-passkey-remove", "menu-open"]],
];

const only = process.argv.slice(2);
const browser = await chromium.launch();
// Inter and Lucide come from the internet; keep them in memory so every shot does not download them again.
const cache = new Map();
async function cachedRoutes(context) {
  await context.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, async (route) => {
    const url = route.request().url();
    if (!cache.has(url)) { const r = await route.fetch(); cache.set(url, { status: r.status(), headers: r.headers(), body: await r.body() }); }
    await route.fulfill(cache.get(url));
  });
}
const report = [];
let errors = 0;
for (const [file, prefix, states] of SCREENS) {
  if (only.length && !only.some((p) => prefix.startsWith(p) || file.startsWith(p))) continue;
  for (const state of states) {
    for (const [w, h] of SIZES) {
      const context = await browser.newContext({ viewport: { width: w, height: h } });
      await cachedRoutes(context);
      const page = await context.newPage();
      page.on("pageerror", (e) => { errors++; report.push(`SCRIPT ERROR ${prefix}-${state}-${w}: ${e.message}`); });
      await page.goto(`${pathToFileURL(path.join(here, file + ".html")).href}?shot#${state}`);
      await page.waitForSelector("html[data-ready]", { timeout: 20000 });
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const out = path.join(here, "screenshots", `${prefix}-${state}-${w}.png`);
      await page.screenshot({ path: out, fullPage: !VIEWPORT_ONLY.test(state) });
      report.push(`${prefix}-${state}-${w}: overflow ${overflow}px`);
      if (overflow > 0) errors++;
      await context.close();
    }
  }
}
await browser.close();
const bad = report.filter((l) => !/ overflow 0px$/.test(l));
console.log(bad.join("\n") || "no sideways overflow and no script error anywhere");
console.log(report.filter((l) => / overflow /.test(l)).length + " screenshots");
process.exit(errors ? 1 : 0);
