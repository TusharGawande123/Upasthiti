// Takes the PNG screenshots of the M4b gate P2 mockups (docs only, not app code).
// Run: node docs/design-refs/m4b/gate-p2/shoot.mjs   (uses Playwright from e2e/node_modules; do not run the e2e tests)
// Then palette-reduce the PNGs: backend/.venv/Scripts/python docs/design-refs/m4b/gate-p2/reduce.py
// Every capture also checks: no sideways page scroll, no script error, smallest text and smallest tap target.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../../e2e/package.json"));
const { chromium } = require("@playwright/test");

const SIZES = [[360, 800], [768, 1024], [1280, 800]];
const FILES = ["01-gate-panel", "02-gate-reader", "03-start", "04-face-punch", "05-gate-code-scan", "06-results"];

const browser = await chromium.launch();
const report = [];
const problems = [];
let count = 0;
for (const file of FILES) {
  // read the state list from the page itself
  const probe = await browser.newPage();
  await probe.goto(pathToFileURL(path.join(here, file + ".html")).href);
  await probe.waitForFunction(() => window.P2_STATES);
  const group = await probe.evaluate(() => document.body.dataset.group);
  const states = await probe.evaluate((g) => window.P2_STATES[g], group);
  await probe.close();
  for (const state of states) {
    for (const [w, h] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${pathToFileURL(path.join(here, file + ".html")).href}?shot#${state}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        let minText = 99;
        const walker = document.createTreeWalker(document.getElementById("root"), NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (!n.textContent.trim()) continue;
          const el = n.parentElement;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || el.closest(".sr-only")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          minText = Math.min(minText, parseFloat(cs.fontSize));
        }
        let minTarget = 999;
        let smallTarget = "";
        document.querySelectorAll("#root button, #root a").forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.width === 0) return;
          const side = Math.min(r.width, r.height);
          if (side < minTarget) { minTarget = side; smallTarget = b.textContent.trim().slice(0, 24) || b.getAttribute("aria-label") || ""; }
        });
        return { overflow, minText, minTarget: Math.round(minTarget), smallTarget };
      });
      const name = `${file}-${state}-${w}`;
      await page.screenshot({ path: path.join(here, "screenshots", name + ".png"), fullPage: true });
      count++;
      if (m.overflow > 0) problems.push(`${name}: SIDEWAYS SCROLL ${m.overflow}px`);
      if (errors.length) problems.push(`${name}: script error ${errors[0]}`);
      const gate = file.startsWith("01") || file.startsWith("02");
      const needText = gate ? 24 : 16;
      const needTarget = gate ? 64 : 48;
      if (m.minText < needText) problems.push(`${name}: smallest text ${m.minText}px (need ${needText})`);
      if (m.minTarget < needTarget && m.minTarget !== 999) problems.push(`${name}: smallest target ${m.minTarget}px "${m.smallTarget}" (need ${needTarget})`);
      report.push(`${name}: overflow ${m.overflow}px, text ${m.minText}px, target ${m.minTarget}px`);
      await page.close();
    }
  }
}
await browser.close();
console.log(problems.join("\n") || "no problems");
console.log(count + " screenshots");
