// Upasthiti – M2 design gate C: takes the screenshots of every mockup state (MOCKUP TOOLING, not app code).
// Run from this folder:  node shoot.mjs            (all states)
//                        node shoot.mjs 01 03      (only names that start with these prefixes)
// Uses the Playwright that the repo already installs under e2e/node_modules (Apache-2.0).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../../e2e/package.json"));
const { chromium } = require("playwright");

// [file, hash, screenshot name, full page?]  Dialog states are 1440 x 900, list states full page.
const SHOTS = [
  ["01-punch-log.html", "", "01-punch-log-default", true],
  ["01-punch-log.html", "auto-refresh", "01-punch-log-auto-refresh", true],
  ["01-punch-log.html", "past-day", "01-punch-log-past-day", true],
  ["01-punch-log.html", "empty", "01-punch-log-empty", true],
  ["01-punch-log.html", "loading", "01-punch-log-loading", true],
  ["01-punch-log.html", "error", "01-punch-log-error", true],
  ["01-punch-log.html", "export-too-large", "01-punch-log-export-too-large", true],
  ["01-punch-log.html", "plant-head", "01-punch-log-plant-head", true],
  ["01-punch-log.html", "corporate-head", "01-punch-log-corporate-head", true],
  ["02-photo-dialogs.html", "view", "02-photo-dialogs-view", false],
  ["02-photo-dialogs.html", "view-dark", "02-photo-dialogs-view-dark", false],
  ["02-photo-dialogs.html", "view-loading", "02-photo-dialogs-view-loading", false],
  ["02-photo-dialogs.html", "purged", "02-photo-dialogs-purged", false],
  ["02-photo-dialogs.html", "not-available", "02-photo-dialogs-not-available", false],
  ["02-photo-dialogs.html", "storage-unavailable", "02-photo-dialogs-storage-unavailable", false],
  ["02-photo-dialogs.html", "compare", "02-photo-dialogs-compare", false],
  ["02-photo-dialogs.html", "compare-none", "02-photo-dialogs-compare-none", false],
  ["03-notices.html", "", "03-notices-default", true],
  ["03-notices.html", "new", "03-notices-new", false],
  ["03-notices.html", "new-filled", "03-notices-new-filled", false],
  ["03-notices.html", "new-errors", "03-notices-new-errors", false],
  ["03-notices.html", "new-all-plants", "03-notices-new-all-plants", false],
  ["03-notices.html", "edit", "03-notices-edit", false],
  ["03-notices.html", "end-now", "03-notices-end-now", false],
  ["03-notices.html", "edit-ended", "03-notices-edit-ended", false],
  ["03-notices.html", "empty", "03-notices-empty", true],
  ["03-notices.html", "plant-head", "03-notices-plant-head", true],
  ["03-notices.html", "new+ph", "03-notices-new-plant-head", false],
  ["03-notices.html", "corporate-head", "03-notices-corporate-head", true],
  ["04-kiosks.html", "", "04-kiosks-default", true],
  ["04-kiosks.html", "sound-off", "04-kiosks-sound-off", true],
  ["04-kiosks.html", "plant-head", "04-kiosks-plant-head", true],
  ["04-kiosks.html", "corporate-head", "04-kiosks-corporate-head", true],
  ["04-kiosks.html", "plant-tab", "04-kiosks-plant-tab", true],
  ["04-kiosks.html", "plant-tab+ph", "04-kiosks-plant-tab-plant-head", true],
  ["04-kiosks.html", "plant-tab+ch", "04-kiosks-plant-tab-corporate-head", true],
  ["05-settings.html", "", "05-settings-default", true],
  ["05-settings.html", "range-error", "05-settings-range-error", true],
  ["05-settings.html", "save-reason", "05-settings-save-reason", false],
  ["05-settings.html", "corporate-head", "05-settings-corporate-head", true],
  ["05-settings.html", "plant-head", "05-settings-plant-head", true],
  ["06-plant-detail.html", "", "06-plant-detail-default", true],
  ["06-plant-detail.html", "plant-head", "06-plant-detail-plant-head", true],
  ["06-plant-detail.html", "corporate-head", "06-plant-detail-corporate-head", true],
];

const filters = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
const page = await context.newPage();
for (const [file, hash, name, fullPage] of SHOTS) {
  if (filters.length && !filters.some((f) => name.startsWith(f))) continue;
  const url = pathToFileURL(path.join(here, file)).href + (hash ? "#" + hash : "");
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(here, "screenshots", name + ".png"), fullPage });
  console.log("shot", name);
}
await browser.close();
