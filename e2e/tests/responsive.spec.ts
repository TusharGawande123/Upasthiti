// The website on a phone and a tablet: no page may scroll sideways, the menu button must reach
// every page, and the gate kiosk (pairing and the punch screens) must fit a phone held upright.
// Plants, people and cards are made through the admin API; other files test the screens themselves.
import { expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  CORPORATE_HEAD_LOGIN,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makeKioskCode,
  makePermanentEmployee,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  SUPER_ADMIN_LOGIN,
} from "./helpers";
import { ADMIN_PAGE_LIST, OTHER_PAGE_LIST, type PageEntry } from "./page-list";

test.describe.configure({ mode: "serial" });

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 360, height: 640 };
const TABLET = { width: 768, height: 1024 };

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

/** The sizes of AC-M6-5..8 (360 px and 768 px) plus the usual phone, which was checked before. */
const LIST_SIZES = [
  ["small phone", SMALL_PHONE],
  ["phone", PHONE],
  ["tablet", TABLET],
] as const;

type PageIds = { plantId: string; employeeId: string };

/** Fills the ":id" of a route from the made-up plant and employee. */
function addressOf(entry: PageEntry, ids: PageIds): string {
  const base = entry.open ?? entry.route;
  if (entry.parameter === "plantId") return base.replace(":plantId", ids.plantId);
  if (entry.parameter === "employeeId") return base.replace(":employeeId", ids.employeeId);
  return base;
}

/** One page of the list: opens it, waits for it, then checks the width and runs axe. */
async function measureListedPage(page: Page, entry: PageEntry, ids: PageIds, where: string) {
  const address = addressOf(entry, ids);
  await page.goto(address);
  await page.waitForLoadState("networkidle");
  if (!entry.noHeading) {
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
  await expectNoSidewaysScroll(page, `${where} ${address}`);
  await expectNoSeriousAccessibilityIssues(page);
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

  const employee = await makePermanentEmployee(api, plant, "PH0-001", "Permanent Employee Name");
  const ids: PageIds = { plantId: plant.id, employeeId: employee.id };

  // Every admin page of the page list (the Corporate Head page is in the next test).
  for (const [label, size] of LIST_SIZES) {
    await page.setViewportSize(size);
    for (const entry of ADMIN_PAGE_LIST.filter((listed) => listed.role === "super")) {
      await measureListedPage(page, entry, ids, label);
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

// M5c: the range register, the one-employee period list and the convert dialog (the reports page
// with its two new cards is in the page list).
test("the M5c screens fit 360 px, a phone and a tablet", async ({ page }) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "PH5");
  const joined = new Date();
  joined.setDate(joined.getDate() - 10);
  const worker = await api.post<{ id: string }>("/employees", {
    employee_code: "PH-501",
    full_name: "Worker With A Fairly Long Name",
    type: "temporary",
    plant_id: plant.id,
    category_id: plant.helperId,
    shift_id: plant.shiftId,
    hourly_rate: "85.00",
    joined_on: joined.toISOString().slice(0, 10),
  });

  for (const [label, size] of [
    ["small phone", SMALL_PHONE],
    ["phone", PHONE],
    ["tablet", TABLET],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto("/admin/attendance/register");
    await settle(page);
    await page.getByRole("button", { name: "Date range" }).click();
    await page.getByRole("button", { name: "Last 30 days" }).click();
    await expectNoSidewaysScroll(page, `${label} register range`);

    await page.goto(`/admin/employees/${worker.id}?tab=attendance`);
    await settle(page);
    await expect(page.getByText("Day by day for a period")).toBeVisible();
    await expectNoSidewaysScroll(page, `${label} employee period list`);

    await page.goto(`/admin/employees/${worker.id}`);
    await settle(page);
    await page.getByRole("button", { name: "Convert to permanent" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSidewaysScroll(page, `${label} convert dialog`);
    await page.keyboard.press("Escape");
  }
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

test("the public privacy notice fits a small phone, a phone and a tablet, without a login", async ({
  browser,
}) => {
  for (const size of [SMALL_PHONE, PHONE, TABLET]) {
    const context = await browser.newContext({
      baseURL: FRONTEND_URL,
      viewport: size,
      locale: "en-IN",
    });
    const reader = await context.newPage();
    await reader.goto("/privacy", { waitUntil: "networkidle" });
    await expect(
      reader.getByRole("heading", { name: "Face and photo attendance at Sheet Shapers" }),
    ).toBeVisible();
    await expectNoSidewaysScroll(reader, `privacy notice ${size.width}px`);
    await context.close();
  }
});

// M4b: the phone attendance pages that need no sign-in. The signed-in pages (home, my attendance,
// passkey, notice) are measured in phone-punch.spec.ts, which signs in with a painted camera.
test("the phone sign-in and check pages fit 360 px, iPhone 13, a phone and a tablet", async ({
  browser,
}) => {
  const IPHONE_13 = { width: 390, height: 844 };
  for (const size of [SMALL_PHONE, IPHONE_13, PHONE, TABLET]) {
    const context = await browser.newContext({
      baseURL: FRONTEND_URL,
      viewport: size,
      locale: "en-IN",
    });
    const reader = await context.newPage();
    for (const path of ["/phone/login", "/phone/setup"]) {
      await reader.goto(path, { waitUntil: "networkidle" });
      await expect(reader.getByRole("heading").first()).toBeVisible();
      await expectNoSidewaysScroll(reader, `${path} ${size.width}px`);
    }
    await context.close();
  }
});

// M5 and M4b: the employee page (Details with the "Phone attendance" card, and the Attendance tab)
// needs an employee id, so it is measured here with a made-up employee.
test("the employee page, its Attendance tab and the Phone attendance card fit 360 px and a tablet", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "PH6");
  const employee = await makePermanentEmployee(
    api,
    plant,
    "PH6-001",
    "Employee With A Fairly Long Name For The Phone Card",
  );

  for (const size of [SMALL_PHONE, TABLET]) {
    await page.setViewportSize(size);
    for (const path of [
      `/admin/employees/${employee.id}`,
      `/admin/employees/${employee.id}?tab=attendance`,
    ]) {
      await page.goto(path);
      await settle(page);
      if (!path.includes("tab=")) {
        await expect(page.getByText("Phone attendance", { exact: true }).first()).toBeVisible();
      }
      await expectNoSidewaysScroll(page, `${size.width}px ${path}`);
    }
  }
});

// The page of the Corporate Head (the list marks it) and the pages that need no login.
test("the Corporate Head page and the pages without a login fit 360 px, a phone and a tablet", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const noIds: PageIds = { plantId: "", employeeId: "" };

  const headContext = await browser.newContext({ baseURL: FRONTEND_URL, locale: "en-IN" });
  const head = await headContext.newPage();
  await logIn(head, CORPORATE_HEAD_LOGIN);
  await expect(head.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  for (const [label, size] of LIST_SIZES) {
    await head.setViewportSize(size);
    for (const entry of ADMIN_PAGE_LIST.filter((listed) => listed.role === "corporate")) {
      await measureListedPage(head, entry, noIds, label);
    }
  }
  await headContext.close();

  // Pages marked "phone" are measured by phone-punch.spec.ts, after a real phone sign-in.
  const anonymousPages = OTHER_PAGE_LIST.filter((listed) => listed.role === "anonymous");
  for (const [label, size] of LIST_SIZES) {
    const context = await browser.newContext({
      baseURL: FRONTEND_URL,
      viewport: size,
      locale: "en-IN",
    });
    const visitor = await context.newPage();
    for (const entry of anonymousPages) {
      await measureListedPage(visitor, entry, noIds, label);
    }
    await context.close();
  }
});
