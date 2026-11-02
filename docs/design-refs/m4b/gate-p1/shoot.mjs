// Screenshot script for M4b gate P1 (run from anywhere: node shoot.mjs [pageFilter] [stateFilter]).
// Renders every state of every page at 360, 768 and 1280 px, checks there is no sideways page scroll, writes raw PNGs to RAW_DIR.
// Then run quantize.py to palette-reduce them into screenshots/. Uses Playwright from e2e/node_modules (not part of the repo tooling).
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire("C:/Projects/Upasthiti/e2e/package.json");
const { chromium } = require("@playwright/test");
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = process.env.RAW_DIR || path.join(here, "raw");
fs.mkdirSync(RAW_DIR, { recursive: true });

const PAGES = {
  "01-login": ["default", "filled", "password-shown", "loading", "wrong-password", "locked", "punch-off", "new-password-required", "signed-out-elsewhere", "session-ended", "too-many-requests", "browser-unsupported", "passkey-offered", "passkey-waiting", "passkey-cancelled", "passkey-invalid"],
  "02-setup": ["choose", "face-code", "face-oval", "face-closer", "face-good", "face-turn-left", "face-straight-again", "face-checking", "face-no-face", "face-liveness-failed", "face-too-slow", "face-service-busy", "proof-failed", "camera-blocked", "card-intro", "card-camera", "card-checking", "card-location-denied", "card-location-unreadable", "card-location-weak", "card-outside", "card-proof-failed", "too-many-requests", "browser-unsupported"],
  "03-password": ["default", "typing-weak", "typing-ok", "mismatch", "shown", "saving", "too-weak", "proof-expired", "punch-off", "too-many-requests"],
  "04-notice": ["default", "loading", "error", "saving", "notice-required", "notice-changed"],
  "05-home": ["face-default", "face-out", "face-no-punch", "face-outside-work", "face-outside-no-date", "face-location-off", "face-location-weak", "face-not-ready", "qr-default", "qr-not-at-plant", "qr-location-off", "no-passkey-support", "punch-off", "loading", "error", "menu-open", "menu-no-passkeys"],
  "06-attendance": ["default", "empty", "loading", "error"],
  "07-passkey": ["intro", "waiting", "added", "list", "removed", "cancelled", "recent-sign-in-required", "limit"],
};
const MENU = new Set(["menu-open", "menu-no-passkeys"]); // viewport only (the sheet is fixed)
const WIDTHS = [[360, 800], [768, 1024], [1280, 800]];
const [pageFilter, stateFilter] = process.argv.slice(2);

const server = http.createServer((req, res) => {
  const f = path.join(here, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(here) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[path.extname(f)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type + "; charset=utf-8" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
let n = 0, bad = 0;
for (const [page, states] of Object.entries(PAGES)) {
  if (pageFilter && !page.startsWith(pageFilter)) continue;
  if (!fs.existsSync(path.join(here, page + ".html"))) continue;
  for (const state of states) {
    if (stateFilter && state !== stateFilter) continue;
    for (const [w, h] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "en-IN" });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e)));
      if (process.env.LUCIDE_LOCAL) await p.route("https://unpkg.com/**", (r) => r.fulfill({ path: process.env.LUCIDE_LOCAL })); // offline copy of lucide (speed)
      await p.goto(`http://localhost:${port}/${page}.html?shot#${state}`, { waitUntil: "networkidle" });
      await p.waitForSelector("html[data-ready]");
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(150);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const name = `${page.split("-")[0]}-${page.split("-").slice(1).join("-")}-${state}-${w}.png`;
      await p.screenshot({ path: path.join(RAW_DIR, name), fullPage: !MENU.has(state) });
      n++;
      if (over > 0 || errors.length) { bad++; console.log(`PROBLEM ${name}: sideways=${over}px errors=${errors.join(";")}`); }
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
console.log(`${n} screenshots, ${bad} problems`);
