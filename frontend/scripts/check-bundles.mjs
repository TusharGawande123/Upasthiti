// Run after `npm run build` (npm run size): prints the size of the important build files against
// their budgets (frontend/size-budgets.json) and fails when one is over, or when the admin's first
// load contains kiosk code (S-28, AC-46). Budgets are the measured size plus 10 percent; raise one
// on purpose, in its own commit, when the app really needs to grow.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkBudgets,
  firstLoadClosure,
  gzipBytes,
  kioskCodeIn,
  readText,
} from "./bundle-check.mjs";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ASSETS = join(DIST, "assets");
const budgets = JSON.parse(readText(new URL("../size-budgets.json", import.meta.url)));

const files = readdirSync(ASSETS).map((name) => ({
  name,
  gzipBytes: gzipBytes(readFileSync(join(ASSETS, name))),
}));
const readAsset = (name) => readText(join(ASSETS, name));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
let failed = false;
const lines = ["| Budget | Gzip size | Limit | |", "|---|---|---|---|"];

for (const row of checkBudgets(budgets, files)) {
  failed ||= !row.ok;
  lines.push(
    `| ${row.name} | ${kb(row.size)} | ${kb(row.max)} | ${row.ok ? "ok" : (row.note ?? "OVER")} |`,
  );
}

// The admin's first load must hold no kiosk code.
const entryFiles = firstLoadClosure(readText(join(DIST, "index.html")), readAsset);
const leaked = kioskCodeIn(entryFiles, readAsset);
lines.push(
  "",
  `First page load: ${entryFiles.length} files (${entryFiles.join(", ")}).`,
  leaked.length === 0
    ? "No kiosk code in the first load: ok."
    : `KIOSK CODE IN THE FIRST LOAD:\n  ${leaked.join("\n  ")}`,
);
failed ||= leaked.length > 0;

console.log(lines.join("\n"));
process.exit(failed ? 1 : 0);
