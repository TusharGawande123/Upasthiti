// Guard (M6 AC-M6-27): every route of router.tsx must be in the page list of
// e2e/tests/page-list.ts, so responsive.spec.ts measures it at 360 px and 768 px and scans it with
// axe. A new page without a list entry fails here, before it can reach a phone unchecked.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read as text: the e2e folder is outside the frontend project, so it cannot be imported.
// Vitest runs from frontend/ (npm test), so these paths start there.
const routerSource = readFileSync(resolve("src/app/router.tsx"), "utf8");
const pageListSource = readFileSync(resolve("../e2e/tests/page-list.ts"), "utf8");

/** Every `path: "..."` of router.tsx as a full address. The phone pages write theirs relative. */
function routesOfTheRouter(): string[] {
  const addresses = new Set<string>();
  const phoneStart = routerSource.indexOf("const phoneArea");
  const phoneEnd = routerSource.indexOf("export const routes");
  for (const match of routerSource.matchAll(/path:\s*"([^"]*)"/g)) {
    const path = match[1] ?? "";
    const position = match.index ?? 0;
    const insidePhoneArea = position > phoneStart && position < phoneEnd;
    if (path.startsWith("/") || path === "*") {
      addresses.add(path);
    } else if (insidePhoneArea) {
      addresses.add(`/phone/${path}`);
    }
  }
  // The phone home page is the index route of /phone.
  addresses.add("/phone");
  return [...addresses];
}

function routesOfThePageList(): string[] {
  return [...pageListSource.matchAll(/route:\s*"([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("page list of the responsive e2e spec", () => {
  it("finds the routes it is supposed to compare", () => {
    expect(routesOfTheRouter().length).toBeGreaterThan(40);
  });

  it("has an entry for every route of router.tsx", () => {
    const listed = new Set(routesOfThePageList());
    const missing = routesOfTheRouter().filter((route) => !listed.has(route));
    expect(missing, `add these routes to e2e/tests/page-list.ts: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("has no entry for a route that is gone", () => {
    const routes = new Set(routesOfTheRouter());
    const stale = routesOfThePageList().filter((route) => !routes.has(route));
    expect(stale, `remove these routes from e2e/tests/page-list.ts: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
