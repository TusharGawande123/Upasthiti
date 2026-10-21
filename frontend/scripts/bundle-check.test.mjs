// The build checks (S-28, AC-46): what counts as the first page load, how kiosk code is found in
// it, and how the size budgets say yes or no. They run on made-up files, never on a real build.
import { describe, expect, it } from "vitest";
import {
  checkBudgets,
  firstLoadClosure,
  firstLoadFiles,
  gzipBytes,
  kioskCodeIn,
  staticImports,
} from "./bundle-check.mjs";

const INDEX_HTML = `<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">
<link rel="stylesheet" crossorigin href="/assets/index-CCC.css">`;

// A tiny fake build: the entry imports a vendor file at once, and loads the kiosk lazily.
const ASSETS = {
  "index-AAA.js": 'import{a}from"./vendor-BBB.js";const kiosk=()=>import("./kiosk-DDD.js");',
  "vendor-BBB.js": 'export const a=1;import"./shared-EEE.js";',
  "shared-EEE.js": "export const b=2;",
  "kiosk-DDD.js": 'navigator.mediaDevices.getUserMedia({});import"./zxing-FFF.js";',
};
const read = (name) => ASSETS[name] ?? "";

describe("first page load", () => {
  it("lists the entry and the preloaded files from index.html, not the styles", () => {
    expect(firstLoadFiles(INDEX_HTML)).toEqual(["assets/index-AAA.js", "assets/vendor-BBB.js"]);
  });

  it("finds static imports but not lazy import() calls", () => {
    expect(staticImports(ASSETS["index-AAA.js"])).toEqual(["vendor-BBB.js"]);
    expect(staticImports(ASSETS["vendor-BBB.js"])).toEqual(["shared-EEE.js"]);
    expect(staticImports(ASSETS["kiosk-DDD.js"])).toEqual(["zxing-FFF.js"]);
  });

  it("follows the static imports all the way and leaves the lazy kiosk chunk out", () => {
    expect(firstLoadClosure(INDEX_HTML, read)).toEqual([
      "index-AAA.js",
      "shared-EEE.js",
      "vendor-BBB.js",
    ]);
  });
});

describe("kiosk code in the first load", () => {
  it("finds none in a clean admin entry", () => {
    expect(kioskCodeIn(firstLoadClosure(INDEX_HTML, read), read)).toEqual([]);
  });

  it("names the file and the marker when the decoder or camera code leaks in", () => {
    const leaky = {
      ...ASSETS,
      "shared-EEE.js": "new BarcodeDetector(); import('./zxing_reader.js')",
    };
    const readLeaky = (name) => leaky[name] ?? "";

    expect(kioskCodeIn(firstLoadClosure(INDEX_HTML, readLeaky), readLeaky)).toEqual([
      "shared-EEE.js: zxing",
      "shared-EEE.js: BarcodeDetector",
    ]);
    expect(kioskCodeIn(["kiosk-DDD.js"], read)).toContain("kiosk-DDD.js: getUserMedia");
  });
});

describe("size budgets", () => {
  const files = [
    { name: "index-AAA.js", gzipBytes: 900 },
    { name: "vendor-BBB.js", gzipBytes: 200 },
    { name: "kiosk-DDD.js", gzipBytes: 500 },
  ];

  it("passes a size within the limit, adding up every file the pattern matches", () => {
    const rows = checkBudgets(
      [{ name: "Admin", pattern: "^(index|vendor)-.*\\.js$", maxGzipBytes: 1100 }],
      files,
    );

    expect(rows).toEqual([{ name: "Admin", ok: true, size: 1100, max: 1100 }]);
  });

  it("fails a size over the limit by one byte", () => {
    const rows = checkBudgets(
      [{ name: "Admin", pattern: "^(index|vendor)-.*\\.js$", maxGzipBytes: 1099 }],
      files,
    );

    expect(rows[0]?.ok).toBe(false);
  });

  it("fails a budget whose pattern matches no file (renamed or removed)", () => {
    const rows = checkBudgets([{ name: "Gone", pattern: "^gone-.*$", maxGzipBytes: 100 }], files);

    expect(rows[0]).toMatchObject({ ok: false, note: "no file matches" });
  });

  it("measures gzip size the way a browser downloads it", () => {
    expect(gzipBytes(Buffer.from("a".repeat(10_000)))).toBeLessThan(100);
    expect(gzipBytes(Buffer.from("x"))).toBeGreaterThan(0);
  });
});
