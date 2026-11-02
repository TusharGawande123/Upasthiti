// Slice B in a real browser: the client's plants, readiness, shifts, the geofence map and the
// setup wizard. Spec AC-6, AC-7, AC-11, AC-31, AC-38.
import { expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import { expectNoSeriousAccessibilityIssues, INSIDE, logIn, SUPER_ADMIN_LOGIN } from "./helpers";

// The tests share one database and the first one adds the plants, so they run in order.
test.describe.configure({ mode: "serial" });

// Other test files add plants at the same time, so the list may or may not be empty. This makes
// sure plant K134 exists: with the client's 7 plants when the list is empty, or on its own.
async function ensurePlantK134(page: Page) {
  await page.getByRole("link", { name: "Plants" }).first().click();
  await expect(page.getByRole("heading", { name: "Plants", exact: true })).toBeVisible();
  // "Add a plant" only shows once the list has loaded (a skeleton is shown before that).
  await expect(page.getByRole("button", { name: "Add a plant" }).first()).toBeVisible();
  const addAll = page.getByRole("button", { name: "Add Sheet Shapers' 7 plants" });
  if (await addAll.isVisible()) {
    await addAll.click();
  } else if ((await page.getByRole("cell", { name: "K134" }).count()) === 0) {
    await page.getByRole("button", { name: "Add a plant" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Code").fill("K134");
    await dialog.getByLabel("Name").fill("Sheet Shapers (K-134)");
    await dialog.getByRole("button", { name: "Add a plant" }).click();
    await page.getByRole("link", { name: "Plants" }).first().click();
  }
  await expect(page.getByRole("cell", { name: "K134" })).toBeVisible();
}

test("Super Admin adds the 7 plants, sees readiness and adds a night shift", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await ensurePlantK134(page);
  await expectNoSeriousAccessibilityIssues(page);

  await page
    .getByRole("link", { name: /K-134|K134/ })
    .first()
    .click();
  await expect(page.getByText("Ready for attendance?")).toBeVisible();
  await expect(page.getByText("No geofence. Draw it on the Geofence tab.")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("tab", { name: "Shifts" }).click();
  await page.getByRole("button", { name: "Add shift" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Shift name").fill("Night");
  await dialog.getByLabel("Starts").fill("19:00");
  await dialog.getByLabel("Ends").fill("07:00");
  // The shift form (M5): the full day is the shift length, and a night shift says it ends next day.
  await expect(dialog.getByText("Ends the next day")).toBeVisible();
  await expect(dialog.getByText("Full day: 12 h", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText(/19:00.{1,3}07:00/).first()).toBeVisible();
});

test("the setup wizard shows the plants step done and the geofence step open", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await ensurePlantK134(page);
  await expect(page.getByRole("cell", { name: "K134" })).toBeVisible();

  await page.getByRole("link", { name: "Setup wizard" }).click();

  await expect(page.getByRole("heading", { name: /1\. Add the plants/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Draw geofence" }).first()).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
});

test("the geofence tab shows a map with the OpenStreetMap credit and draws a polygon", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await ensurePlantK134(page);
  await page
    .getByRole("link", { name: /K-134|K134/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Geofence" }).click();

  const map = page.getByRole("application", { name: "Map of the plant geofence" });
  await expect(map).toBeVisible();
  await expect(page.getByText("OpenStreetMap")).toBeVisible();

  // Draw a square with the free Geoman tool: click the tool, click 4 corners, click the first again.
  await page.locator(".leaflet-pm-icon-polygon").click();
  const box = await map.boundingBox();
  if (!box) throw new Error("The map has no size.");
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  for (const [dx, dy] of [
    [-80, -80],
    [80, -80],
    [80, 80],
    [-80, 80],
    [-80, -80],
  ]) {
    await page.mouse.click(centreX + dx, centreY + dy);
  }

  await expect(page.getByText("Polygon · 4 corners")).toBeVisible();
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("v1", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 1 · current")).toBeVisible();
});

test("the geofence map shows where the admin stands and has a satellite view", async ({
  browser,
}) => {
  // A browser that allows location, with a fake GPS position.
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    geolocation: INSIDE,
    permissions: ["geolocation"],
    locale: "en-IN",
  });
  const page = await context.newPage();
  try {
    await logIn(page, SUPER_ADMIN_LOGIN);
    await ensurePlantK134(page);
    await page
      .getByRole("link", { name: /K-134|K134/ })
      .first()
      .click();
    await page.getByRole("tab", { name: "Geofence" }).click();
    await expect(
      page.getByRole("application", { name: "Map of the plant geofence" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Show my location" }).click();
    await expect(page.getByText(/^You are here \(about \d+ m\)$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop showing my location" })).toBeVisible();

    await page.getByRole("radio", { name: "Satellite" }).click();
    await expect(page.getByText(/Esri/)).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);
  } finally {
    await context.close();
  }
});
