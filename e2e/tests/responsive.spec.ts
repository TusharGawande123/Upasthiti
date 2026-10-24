// The website on a phone and a tablet: no page may scroll sideways, the menu button must reach
// every page, and the gate kiosk (pairing and the punch screens) must fit a phone held upright.
// Plants, people and cards are made through the admin API; other files test the screens themselves.
import { expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  logIn,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  SUPER_ADMIN_LOGIN,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 360, height: 640 };
const TABLET = { width: 768, height: 1024 };

// Pages with a table or a long form: the ones that were too wide on a phone.
const ADMIN_PAGES = [
  "/admin",
  "/admin/employees",
  "/admin/employees/new",
  "/admin/qr-cards",
  "/admin/punches",
  "/admin/plants",
  "/admin/kiosks",
  "/admin/approvals",
  "/admin/settings",
  "/admin/audit",
  "/admin/users",
  "/admin/notices",
];

/** The whole page must fit the screen width (a table may scroll inside its own card). */
async function expectNoSidewaysScroll(page: Page, where: string) {
  // clientWidth is the room for the page: a visible scrollbar (in a headed browser, on a long
  // page) takes some of the screen, and that is fine.
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
  }));
  expect(
    widths.page,
    `${where}: page is ${widths.page}px wide on a ${widths.screen}px screen`,
  ).toBeLessThanOrEqual(widths.screen);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Wait for the page's own heading so a loading screen is not measured by mistake.
  await expect(page.getByRole("heading").first()).toBeVisible();
}

test("the admin pages fit a phone and a tablet, and the menu button reaches every page", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "PH0");
  for (let number = 1; number <= 4; number++) {
    await makeWorkerWithCard(
      api,
      plant,
      `PH-0${number}`,
      `Worker With A Fairly Long Name ${number}`,
    );
  }

  for (const [label, size] of [
    ["phone", PHONE],
    ["tablet", TABLET],
  ] as const) {
    await page.setViewportSize(size);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await settle(page);
      await expectNoSidewaysScroll(page, `${label} ${path}`);
    }
  }

  // On a phone the left menu is hidden: the menu button opens the slide-out menu.
  await page.setViewportSize(PHONE);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Open the menu" }).click();
  const menu = page.getByRole("dialog", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "QR cards" })).toBeVisible();
  await menu.getByRole("link", { name: "QR cards" }).click();
  await expect(page.getByRole("heading", { name: "QR cards" })).toBeVisible();
  await expect(menu).toBeHidden();

  // On a laptop the left menu is there and the menu button is not.
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole("button", { name: "Open the menu" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
});

test("the kiosk pairing screen fits a phone held upright, even a small one", async ({
  browser,
}) => {
  for (const size of [PHONE, SMALL_PHONE]) {
    const context = await browser.newContext({
      baseURL: FRONTEND_URL,
      viewport: size,
      locale: "en-IN",
    });
    const device = await context.newPage();
    await device.goto("/attendance", { waitUntil: "networkidle" });
    await expect(device.getByRole("heading", { name: "Pair this device" })).toBeVisible();
    await expectNoSidewaysScroll(device, `kiosk pairing ${size.width}px`);

    // Every digit box and the last keypad button sit inside the screen.
    for (const digit of ["4", "8", "2", "9", "1", "3"]) {
      await device.getByRole("button", { name: digit, exact: true }).click();
    }
    const boxes = device.locator("fieldset > span");
    await expect(boxes).toHaveCount(6);
    const last = await boxes.nth(5).boundingBox();
    expect(last && last.x + last.width).toBeLessThanOrEqual(size.width);
    const back = await device.getByRole("button", { name: "Back" }).boundingBox();
    expect(back && back.x + back.width).toBeLessThanOrEqual(size.width);
    await context.close();
  }
});

test("the kiosk scanning and result screens fit a phone held upright", async ({ page }) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "PH1");
  const card = await makeWorkerWithCard(api, plant, "PH-101", "Asha Kale");
  const code = await makeKioskCode(api, plant, "Phone gate");

  const { device, close } = await openKioskWithCard(card.serial, code, PHONE);
  try {
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible();
    await expectNoSidewaysScroll(device, "kiosk scanning on a phone");

    await expect(device.getByText("IN", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(device.getByText("Asha Kale")).toBeVisible();
    await expectNoSidewaysScroll(device, "kiosk result on a phone");
    // The result screen fills the phone: all of it (up to the "back in" bar) fits without scrolling.
    const fits = await device
      .getByRole("status")
      .first()
      .evaluate((overlay) => ({
        content: overlay.scrollHeight,
        screen: overlay.clientHeight,
      }));
    expect(fits.content, "result screen is taller than the phone").toBeLessThanOrEqual(fits.screen);
  } finally {
    await close();
  }
});
