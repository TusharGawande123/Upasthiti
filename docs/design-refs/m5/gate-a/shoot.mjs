// Takes the PNG screenshots of the M5 gate A mockups (docs only, not app code).
// Run from anywhere: node docs/design-refs/m5/gate-a/shoot.mjs   (uses Playwright from e2e/node_modules)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../../e2e/package.json"));
const { chromium } = require("@playwright/test");

const SIZES = [[360, 800], [768, 1024], [1280, 800]];
const SCREENS = [
  ["dashboard", "01-dashboard", ["default", "stale", "loading", "picker-open", "demo", "not-started", "no-employees", "plant-head", "menu-open"]],
  ["dashboard", "02-dashboard-all", ["all-plants", "all-plants-demo", "all-plants-loading"]],
  ["muster", "03-muster", ["default", "search", "loading", "offline", "empty", "all-plants", "plant-head", "demo", "picker-open", "print"]],
];

const browser = await chromium.launch();
const report = [];
for (const [file, prefix, states] of SCREENS) {
  for (const state of states) {
    for (const [w, h] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(`${pathToFileURL(path.join(here, file + ".html")).href}?shot#${state}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const out = path.join(here, "screenshots", `${prefix}-${state}-${w}.png`);
      await page.screenshot({ path: out, fullPage: true });
      report.push(`${prefix}-${state}-${w}: overflow ${overflow}px`);
      await page.close();
    }
  }
}
// The print sheet at its real A4 size (96 dpi: 794 x 1123 px)
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto(`${pathToFileURL(path.join(here, "muster.html")).href}?shot#print`);
await page.waitForLoadState("networkidle");
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { document.querySelector(".print-stage").style.zoom = 1; });
await page.locator(".paper").first().screenshot({ path: path.join(here, "screenshots", "03-muster-print-a4-page1.png") });
await page.close();
await browser.close();
console.log(report.filter((l) => !/ overflow 0px/.test(l) || /-(360|768):/.test(l) && !/overflow 0px/.test(l)).join("\n") || "no sideways overflow anywhere");
console.log(report.length + " screenshots");
