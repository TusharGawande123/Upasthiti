// Slice C in real browsers: the admin makes a pairing code, and a second browser (the gate
// device) pairs with fake GPS. Spec AC-13, AC-14, AC-15, AC-38, AC-39.
import { expect, type Page, test } from "@playwright/test";
import {
  expectNoSeriousAccessibilityIssues,
  FAR_AWAY,
  INSIDE,
  logIn,
  openKioskDevice,
  readPairingCode,
  SUPER_ADMIN_LOGIN,
} from "./helpers";

// The tests share one database; this file makes its own plant so other files do not clash.
test.describe.configure({ mode: "serial" });

async function drawGeofenceAroundMapCentre(page: Page) {
  const map = page.getByRole("application", { name: "Map of the plant geofence" });
  await expect(map).toBeVisible();
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
  await expect(page.getByText("Version 1 · current")).toBeVisible();
}

async function addKiosk(page: Page, name: string): Promise<string> {
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("link", { name: "Attendance devices" })
    .click();
  await page.getByRole("button", { name: "Add device" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Plant").selectOption({ label: "KT1 · Kiosk Test Plant" });
  await dialog.getByLabel("Device name").fill(name);
  await dialog.getByRole("button", { name: "Make pairing code" }).click();
  return readPairingCode(page);
}

test("Super Admin makes a plant with a geofence, then a kiosk pairs inside it", async ({
  page,
  browser,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Plants" }).click();
  // The "Add a plant" button exists on an empty list and on a filled one.
  await page.getByRole("button", { name: "Add a plant" }).first().click();
  const plantDialog = page.getByRole("dialog");
  await plantDialog.getByLabel("Code").fill("kt1");
  await plantDialog.getByLabel("Name").fill("Kiosk Test Plant");
  await plantDialog.getByRole("button", { name: "Add a plant" }).click();
  await expect(page.getByRole("heading", { name: "Kiosk Test Plant" })).toBeVisible();

  await page.getByRole("tab", { name: "Geofence" }).click();
  await drawGeofenceAroundMapCentre(page);

  const code = await addKiosk(page, "Main gate tablet");
  await expectNoSeriousAccessibilityIssues(page);

  const { context, device } = await openKioskDevice(browser, { geolocation: INSIDE });
  await device.goto(`/attendance?code=${code}`);
  await expect(device.getByText("Code filled in from the link.")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(device);
  await device.getByRole("button", { name: "Pair this device" }).click();
  // Paired: the device opens the attendance screen straight away (M2), with the plant and the
  // kiosk in its top bar. (This device has no camera; the camera clip comes with the punch test.)
  await expect(device.getByText("Kiosk Test Plant · KT1")).toBeVisible();
  await expect(device.getByText("Main gate tablet", { exact: true })).toBeVisible();

  // The admin dialog notices the pairing on its own.
  await expect(page.getByText("Main gate tablet is paired")).toBeVisible({ timeout: 15_000 });

  // After a reload the device is still paired (key kept in IndexedDB) and asks for no code.
  await device.reload();
  await expect(device.getByText("Kiosk Test Plant · KT1")).toBeVisible();
  await context.close();
});

test("a device outside the geofence or without location permission is refused with clear words", async ({
  page,
  browser,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  const firstCode = await addKiosk(page, "Far away phone");

  const far = await openKioskDevice(browser, { geolocation: FAR_AWAY });
  await far.device.goto(`/attendance?code=${firstCode}`);
  await far.device.getByRole("button", { name: "Pair this device" }).click();
  await expect(far.device.getByRole("heading", { name: "Not at the plant" })).toBeVisible();
  await expect(far.device.getByText("OUTSIDE_GEOFENCE")).toBeVisible();
  await far.context.close();

  const noPermission = await openKioskDevice(browser, { allowLocation: false });
  await noPermission.device.goto(`/attendance?code=${firstCode}`);
  await noPermission.device.getByRole("button", { name: "Pair this device" }).click();
  await expect(noPermission.device.getByRole("heading", { name: "Location is off" })).toBeVisible();
  await noPermission.context.close();
});

test("a Super Admin revokes a kiosk and the device shows 'Switched off'", async ({
  page,
  browser,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  const code = await addKiosk(page, "Gate to revoke");
  const { context, device } = await openKioskDevice(browser, { geolocation: INSIDE });
  await device.goto(`/attendance?code=${code}`);
  await device.getByRole("button", { name: "Pair this device" }).click();
  await expect(device.getByText("Kiosk Test Plant · KT1")).toBeVisible();

  await page.getByRole("button", { name: "Close" }).first().click();
  const row = page.getByRole("row", { name: /Gate to revoke/ });
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Phone lost");
  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(row.getByText("Switched off")).toBeVisible();

  await device.reload();
  await expect(device.getByRole("heading", { name: "Switched off" })).toBeVisible();
  await context.close();
});
