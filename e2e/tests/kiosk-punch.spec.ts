// M2 QR attendance in a real browser whose camera plays a clip of a printed card (spec AC-7,
// AC-10, AC-11, AC-32, design gate B). The card shows for about 1.5 s every 21.5 s, so one
// test sees several scans of the same card. Plants, people, cards and kiosks are made through
// the admin API; the admin screens have their own tests.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  SUPER_ADMIN_LOGIN,
  type TestPlant,
} from "./helpers";

// The tests share one database: this file makes its own plants and runs in order.
test.describe.configure({ mode: "serial" });

// A clip repeats every 21.5 s; a scan, its result and the next scan need a little longer.
const NEXT_SCAN = { timeout: 45_000 };
let gatePlant: TestPlant;
let otherPlant: TestPlant;

async function setUpPlants(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  gatePlant ??= await makePlant(api, "PG1");
  otherPlant ??= await makePlant(api, "PG2");
  return api;
}

test("a worker punches IN, then sees ALREADY IN, and a revoked card is NOT ACCEPTED", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await setUpPlants(page);
  const card = await makeWorkerWithCard(api, gatePlant, "PG-101", "Asha Kale");
  const code = await makeKioskCode(api, gatePlant, "Punch gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    // Zero taps after pairing: the camera starts and the first scan is an IN.
    await expect(device.getByText("Plant PG1 · PG1")).toBeVisible();
    await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("Asha Kale")).toBeVisible();
    await expect(device.getByText("Employee code PG-101 · Checked in")).toBeVisible();
    await expectNoSeriousAccessibilityIssues(device);

    // Back to scanning by itself; the scanning screen passes the accessibility scan too.
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible();
    await expect(device.getByText("Asha Kale")).toBeHidden({ timeout: 10_000 });
    await expectNoSeriousAccessibilityIssues(device);

    // The clip shows the same card again: the server says it is already IN (cool-down).
    await expect(device.getByText("ALREADY IN", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(
      device.getByText(/^Already IN at \d\d:\d\d\. No need to punch again\.$/),
    ).toBeVisible();

    // The Super Admin blocks the card; the next scan is refused, without the name.
    await api.post(`/qr-cards/${card.cardId}/revoke`, { kind: "lost", reason: "Card lost" });
    await expect(device.getByText("This card is blocked.")).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("NOT ACCEPTED", { exact: true })).toBeVisible();
    await expect(device.getByText("QR_REVOKED")).toBeVisible();
    await expect(device.getByText("Asha Kale")).toBeHidden();
    await expectNoSeriousAccessibilityIssues(device);
  } finally {
    await close();
  }
});

test("a TEST card shows KIOSK OK and records no attendance", async ({ page }) => {
  test.setTimeout(120_000);
  const api = await setUpPlants(page);
  const testCard = await api.post<{ serial: string }>("/qr-test-cards", { label: "Gate check" });
  const code = await makeKioskCode(api, gatePlant, "Self-test gate");

  const { device, close } = await openKioskWithCard(testCard.serial, code);
  try {
    await expect(device.getByText("KIOSK OK", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("No attendance was recorded.")).toBeVisible();
  } finally {
    await close();
  }
});

test("a card used at another plant's gate is NOT ACCEPTED, without the name", async ({ page }) => {
  test.setTimeout(120_000);
  const api = await setUpPlants(page);
  const card = await makeWorkerWithCard(api, gatePlant, "PG-102", "Ravi Shinde");
  const code = await makeKioskCode(api, otherPlant, "Other plant gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    await expect(device.getByText("This card is for another plant.")).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("WRONG_PLANT")).toBeVisible();
    await expect(device.getByText("Ravi Shinde")).toBeHidden();
  } finally {
    await close();
  }
});
