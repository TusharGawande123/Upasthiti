// Checks the built service worker of the gate page (M4 spec §7 rule 13, §8.2). Run after the
// build (npm run size). The worker must:
//  - exist, with a manifest whose scope is /attendance;
//  - cache only /assets/, /models/ and /locales/ at run time, never /api/ and never /version.json
//    (punches and the self-update need the network);
//  - leave /api/ out of the page-shell fallback;
// and vercel.json must let /sw.js control /attendance (Service-Worker-Allowed).
import { existsSync, readFileSync } from "node:fs";

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

check(existsSync("dist/sw.js"), "dist/sw.js is missing (the service worker was not built).");
if (existsSync("dist/sw.js")) {
  const worker = readFileSync("dist/sw.js", "utf8");
  const cachedPaths = [...worker.matchAll(/startsWith\("([^"]+)"\)/g)].map((match) => match[1]);
  const allowed = new Set(["/assets/", "/models/", "/locales/"]);
  for (const path of cachedPaths) check(allowed.has(path), `The worker caches ${path}.`);
  check(cachedPaths.length > 0, "The worker has no run-time cache rules.");
  check(
    !worker.includes("version.json"),
    "The worker mentions version.json (it must stay network-only).",
  );
  check(
    worker.includes(String.raw`denylist:[/^\/api\//]`),
    "The page-shell fallback does not leave /api/ out.",
  );
}

const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
check(
  manifest.scope === "/attendance",
  `The manifest scope is ${manifest.scope}, not /attendance.`,
);
check(!/kiosk/i.test(JSON.stringify(manifest)), 'The manifest says "kiosk" (people read it).');

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const swHeaders = vercel.headers.find((entry) => entry.source === "/sw.js")?.headers ?? [];
const allowedScope = swHeaders.find((header) => header.key === "Service-Worker-Allowed");
check(
  allowedScope?.value === "/attendance",
  "vercel.json must send Service-Worker-Allowed: /attendance for /sw.js.",
);

if (problems.length > 0) {
  console.error(`Service worker check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Service worker OK: gate scope only, never /api/ or /version.json.");
