// Slice B in a real browser: the client's plants, readiness, shifts, the geofence map and the
// setup wizard. Spec AC-6, AC-7, AC-11, AC-31, AC-38.
import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityIssues, logIn, SUPER_ADMIN_LOGIN } from "./helpers";

// The tests share one database and the first one adds the plants, so they run in order.
test.describe.configure({ mode: "serial" });

test("Super Admin adds the 7 plants, sees readiness and adds a night shift", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Plants" }).click();

  await page.getByRole("button", { name: "Add Sheet Shapers' 7 plants" }).click();
  await expect(page.getByRole("cell", { name: "K134" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TP2" })).toBeVisible();
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
  await expect(
    dialog.getByText("Night: starts 19:00, ends next day at 07:00 (12 h 00 min)."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Save shift" }).click();
  await expect(page.getByRole("cell", { name: /19:00–07:00/ })).toBeVisible();
});

test("the setup wizard shows the plants step done and the geofence step open", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Plants" }).click();
  const addAll = page.getByRole("button", { name: "Add Sheet Shapers' 7 plants" });
  if (await addAll.isVisible()) await addAll.click();
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
  await page.getByRole("link", { name: "Plants" }).click();
  const addAll = page.getByRole("button", { name: "Add Sheet Shapers' 7 plants" });
  if (await addAll.isVisible()) await addAll.click();
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
  await expect(page.getByText("v1")).toBeVisible();
  await expect(page.getByText("Version 1 · current")).toBeVisible();
});
