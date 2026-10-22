// Checks of the production build (spec M2 S-28, AC-46): the size of the important files stays
// within budget, and the code that every visitor downloads first (the admin entry) contains no
// kiosk code: no QR decoder, camera, voice or screen-awake code. The kiosk code belongs in its own
// chunk that only /kiosk loads. Pure functions here; `check-bundles.mjs` runs them on `dist/`.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// Texts that only kiosk code uses. They survive minification because they are browser API names
// and library messages, so finding one in the entry means kiosk code leaked into the admin.
export const KIOSK_ONLY_MARKERS = [
  "zxing",
  "BarcodeDetector",
  "getUserMedia",
  "wakeLock",
  "speechSynthesis",
  "createOscillator",
  "Dexie",
];

/** The gzip size of a file's bytes, as a browser would download it. */
export function gzipBytes(content) {
  return gzipSync(content, { level: 9 }).length;
}

/** The files named in index.html that the browser loads first: the entry and its preloads. */
export function firstLoadFiles(indexHtml) {
  const found = new Set();
  for (const match of indexHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/** The files a JavaScript file loads at once with `import ... from "./x.js"` (not import()). */
export function staticImports(source) {
  const found = new Set();
  for (const match of source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/** Everything the first page load runs: the first files and what they import, recursively. */
export function firstLoadClosure(indexHtml, readAsset) {
  const queue = firstLoadFiles(indexHtml).map((path) => path.replace(/^assets\//, ""));
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    for (const imported of staticImports(readAsset(name))) queue.push(imported);
  }
  return [...seen].sort();
}

/** The kiosk-only markers found in the given files, as "file: marker" lines. */
export function kioskCodeIn(names, readAsset) {
  const problems = [];
  for (const name of names) {
    const source = readAsset(name);
    for (const marker of KIOSK_ONLY_MARKERS) {
      if (source.includes(marker)) problems.push(`${name}: ${marker}`);
    }
  }
  return problems;
}

/**
 * Compares measured sizes with the budgets. `budgets` is a list of { name, pattern, maxGzipBytes };
 * `files` a list of { name, gzipBytes }. A budget whose pattern matches no file is a problem too
 * (the file was renamed or removed, so the budget would silently check nothing).
 */
export function checkBudgets(budgets, files) {
  const rows = [];
  for (const budget of budgets) {
    const pattern = new RegExp(budget.pattern);
    const matches = files.filter((file) => pattern.test(file.name));
    if (matches.length === 0) {
      rows.push({
        name: budget.name,
        ok: false,
        note: "no file matches",
        size: 0,
        max: budget.maxGzipBytes,
      });
      continue;
    }
    const size = matches.reduce((total, file) => total + file.gzipBytes, 0);
    rows.push({
      name: budget.name,
      ok: size <= budget.maxGzipBytes,
      size,
      max: budget.maxGzipBytes,
    });
  }
  return rows;
}

export function readText(path) {
  return readFileSync(path, "utf8");
}
