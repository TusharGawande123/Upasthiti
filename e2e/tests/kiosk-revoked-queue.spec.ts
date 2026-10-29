// M4, the end of a switched-off device that still has saved punches (spec M4 §4.6, §7 rule 12;
// AC-20): a gate saves a punch while the internet is down, the admin switches the device off, the
// internet comes back and the gate shows "Switched off" with how many saved punches could not be
// sent. The same run looks at the admin's device drawer (last position on a map) and checks that
// neither the gate nor the drawer scrolls sideways on a 360 px phone and a 768 px tablet.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
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
const SIZES = [
  { label: "360 px phone", width: 360, height: 740, suffix: "A" },
  { label: "768 px tablet", width: 768, height: 1024, suffix: "B" },
] as const;

let plant: TestPlant;

async function expectNoSidewaysScroll(page: Page, where: string) {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
  }));
  expect(
    widths.page,
    `${where}: page is ${widths.page}px wide on a ${widths.screen}px screen`,
  ).toBeLessThanOrEqual(widths.screen);
}

for (const size of SIZES) {
  test(`a switched-off gate says how many saved punches were lost (${size.label})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    await logIn(page, SUPER_ADMIN_LOGIN);
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    const api = adminApi(page);
    // A retry starts a fresh worker but the database keeps the first attempt's plant and
    // employee, so every attempt uses its own codes (a plain retry would fail with 409).
    const attempt = testInfo.retry;
    plant ??= await makePlant(api, `XQ${7 + attempt}`);
    const name = `Revoked gate ${size.suffix}${attempt}`;
    const card = await makeWorkerWithCard(
      api,
      plant,
      `XQ-7${attempt}${size.suffix}`,
      "Mangal Jadhav",
    );
    const code = await makeKioskCode(api, plant, name);

    const { device, close } = await openKioskWithCard(card.serial, code, {
      width: size.width,
      height: size.height,
    });
    try {
      // 1. Online: the first scan is an IN (it also gives the gate its server time anchor).
      await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);

      // The gate reports its position with the next heartbeat (one a minute, the first one a
      // minute after the page opened); wait until the admin side knows it, so the drawer has a
      // last position to show. Three beats of room, because a busy CI machine can be slow.
      await expect
        .poll(
          async () => {
            const list = await api.get<
              Array<{ name: string; location: { lat: number | null } | null }>
            >(`/kiosks?plant_id=${plant.id}`);
            return list.find((item) => item.name === name)?.location?.lat ?? null;
          },
          { timeout: 200_000, intervals: [5_000] },
        )
        .not.toBeNull();

      // 2. The network goes away: the next scan is saved on the device.
      await device.context().setOffline(true);
      // The SAVED screen only shows for a few seconds (kiosk-offline.spec.ts looks at it); what
      // stays is the waiting line in the footer, so this test waits for that.
      await expect(device.getByText(/^1 punch waiting since \d\d:\d\d$/)).toBeVisible(NEXT_SCAN);
      await expectNoSidewaysScroll(device, `gate ${size.label} with a saved punch`);

      // 3. The admin looks at the device: its drawer shows the last position on a map.
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/admin/kiosks");
      await page.getByRole("button", { name, exact: true }).click();
      const drawer = page.getByRole("dialog");
      await expect(
        drawer.getByRole("img", {
          name: "Last position of this attendance device and the plant fence",
        }),
      ).toBeVisible({ timeout: 30_000 });
      const drawerWidths = await drawer.evaluate((element) => ({
        content: element.scrollWidth,
        box: element.clientWidth,
      }));
      expect(drawerWidths.content, `drawer ${size.label}`).toBeLessThanOrEqual(drawerWidths.box);
      await expectNoSidewaysScroll(page, `admin devices page ${size.label} with the drawer open`);
      await page.keyboard.press("Escape");

      // 4. The admin switches the device off while it still holds a saved punch.
      const kiosks = await api.get<Array<{ id: string; name: string }>>(
        `/kiosks?plant_id=${plant.id}`,
      );
      const kiosk = kiosks.find((item) => item.name === name);
      expect(kiosk, "the device is in the list").toBeTruthy();
      await api.post(`/kiosks/${kiosk?.id}/revoke`, { reason: "Phone lost (e2e)" });

      // 5. The network is back: the gate learns it is switched off, says how many saved punches
      // could not be sent, and has deleted them.
      await device.context().setOffline(false);
      await expect(device.getByRole("heading", { name: "Switched off" })).toBeVisible({
        timeout: 150_000,
      });
      await expect(
        device.getByText("1 saved punch could not be sent. Please visit the plant office."),
      ).toBeVisible();
      await expectNoSidewaysScroll(device, `gate "Switched off" ${size.label}`);
    } finally {
      await close();
    }
  });
}
