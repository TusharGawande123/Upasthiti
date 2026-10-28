// M4 "Needs review" in a real browser (spec M4 §4.8; AC-24, AC-25, AC-26, AC-27). A real gate
// makes the punches: one at the edge of the fence (flagged, counts at once), which the Super Admin
// confirms; and one with a blocked card (rejected, names the worker), which the Super Admin
// approves as OUT. The open review panel must also fit a 360 px phone.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  INSIDE,
  logIn,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  SUPER_ADMIN_LOGIN,
  type TestPlant,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const NEXT_SCAN = { timeout: 45_000 };
// makePlant draws a square 0.002 degrees on each side of INSIDE with a 25 m margin.
const METRES_PER_DEGREE_LAT = 111_195;
const AT_THE_EDGE = { ...INSIDE, latitude: INSIDE.latitude + 0.002 + 18 / METRES_PER_DEGREE_LAT };

let plant: TestPlant;

async function setUp(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  plant ??= await makePlant(api, "RV1");
  return api;
}

async function expectNoSidewaysScroll(page: Page) {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.screen);
}

test("a punch at the edge of the fence is flagged, and the Super Admin confirms it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await setUp(page);
  const card = await makeWorkerWithCard(api, plant, "RV-101", "Sunita Pawar");
  const code = await makeKioskCode(api, plant, "Review edge gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    await expect(device.getByText(/^Location good/)).toBeVisible({ timeout: 20_000 });
    await device.context().setGeolocation(AT_THE_EDGE);
    await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
  } finally {
    await close();
  }

  await page.goto(`/admin/review?q=RV-101`);
  await expect(page.getByRole("heading", { name: "Needs review" })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: /Needs review/ })).toContainText(/\d/);
  await page.getByRole("button", { name: /Review the punch of Sunita Pawar/ }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("At the edge of the fence").first()).toBeVisible();
  await expect(
    sheet.getByText(/^\d+ m outside the drawn fence, inside the 25 m margin$/),
  ).toBeVisible();
  await expect(sheet.getByText("Counts as IN until you decide")).toBeVisible();
  await expect(sheet.getByRole("img", { name: /outside the drawn fence/ })).toBeVisible();

  // The panel fits a small phone too (full screen there).
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await sheet.getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm this punch" });
  await dialog.getByLabel(/Note/).fill("Gate is at the corner of the fence");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/^Confirmed/).first()).toBeVisible();

  await page.getByRole("tab", { name: /Reviewed/ }).click();
  await expect(page.getByRole("button", { name: /Review the punch of Sunita Pawar/ })).toBeVisible();
  const log = await api.get<{ items: Array<{ decision: string; review_state: string }> }>(
    `/punches?plant_id=${plant.id}&q=RV-101`,
  );
  expect(log.items[0]).toMatchObject({ decision: "flagged", review_state: "confirmed" });
});

test("a rejected punch that names the worker is approved as IN", async ({ page }) => {
  test.setTimeout(180_000);
  const api = await setUp(page);
  // A card works only at its owner's plant: shown at the other plant's gate it is NOT ACCEPTED
  // (WRONG_PLANT), and the punch names the worker. (A revoked or expired card names nobody: the
  // card may be in someone else's hand, M2.)
  const otherPlant = await makePlant(api, "RV2");
  const card = await makeWorkerWithCard(api, plant, "RV-102", "Ganesh Kale");
  const code = await makeKioskCode(api, otherPlant, "Review other plant gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    await expect(device.getByText("WRONG_PLANT")).toBeVisible(NEXT_SCAN);
  } finally {
    await close();
  }

  await page.goto("/admin/review?tab=rejected&q=RV-102");
  await page
    .getByRole("button", { name: /Review the punch of Ganesh Kale/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("WRONG_PLANT").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Approve" }).click();

  const dialog = page.getByRole("dialog", { name: "Approve this punch" });
  // Nothing counts for him yet, so IN is suggested.
  await expect(dialog.getByRole("radio", { name: /Count as IN/ })).toBeChecked();
  await expect(dialog.getByText("Suggested")).toBeVisible();
  await dialog.getByLabel(/Reason/).fill("Sent to plant RV2 for the day by the supervisor");
  await dialog.getByRole("button", { name: "Approve as IN" }).click();
  await expect(page.getByText(/^Approved/).first()).toBeVisible();

  const log = await api.get<{
    items: Array<{ decision: string; review_state: string | null; review_direction: string }>;
  }>(`/punches?plant_id=${otherPlant.id}&q=RV-102&decision=rejected`);
  const approved = log.items.find((item) => item.review_state === "approved");
  expect(approved).toMatchObject({ decision: "rejected", review_direction: "in" });
});
