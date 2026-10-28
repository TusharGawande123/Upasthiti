// M4: the gate keeps taking punches while the internet is down, and the server decides them when
// it is back (spec M4 AC-8, AC-10; demo scenario 5). In a real browser the network is cut with
// Playwright. The card clip shows the card about every 21 s: the first scan is an online IN, the
// next one happens offline and is saved on the device ("SAVED", no name, no IN/OUT); after the
// network is back the gate sends it by itself and the punch log shows the server's decision.
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
let plant: TestPlant;

async function setUp(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  plant ??= await makePlant(api, "PO1");
  return api;
}

test("a punch made without internet is saved, sent when the network is back, and decided by the server", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = await setUp(page);
  const card = await makeWorkerWithCard(api, plant, "PO-101", "Rekha Pawar");
  const code = await makeKioskCode(api, plant, "Offline gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    // 1. Online: the first scan is an IN (this also gives the gate its server time anchor).
    await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("Rekha Pawar")).toBeVisible();
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible();

    // 2. The network goes away. The next scan is saved on the device, not lost.
    await device.context().setOffline(true);
    await expect(device.getByText("SAVED", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("Saved – will be confirmed")).toBeVisible();
    await expect(device.getByText(/Your punch is saved on this attendance device/)).toBeVisible();
    // Nothing is decided yet: no name, no IN or OUT on the screen.
    await expect(device.getByText("Rekha Pawar")).toBeHidden();
    await expect(device.getByText("IN", { exact: true })).toBeHidden();
    await expect(device.getByText("1 saved")).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText(/^1 punch waiting since \d\d:\d\d$/)).toBeVisible();

    // 3. The network is back: the gate finds out at its next heartbeat and sends the punch.
    await device.context().setOffline(false);
    await expect(device.getByText(/^All punches sent ✓ \d\d:\d\d$/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(device.getByText("1 saved")).toBeHidden();

    // 4. The server decided it: the card was punched about half a minute before, so the saved
    // punch is refused as a double punch (decided at sync, with its own time). The clip may also
    // have shown the card again after the network came back: that is one more double punch.
    const log = await api.get<{ items: Array<{ decision: string; reason_codes: string[] }> }>(
      `/punches?plant_id=${plant.id}&q=PO-101`,
    );
    const accepted = log.items.filter((item) => item.decision === "accepted");
    const refused = log.items.filter((item) => item.decision === "rejected");
    expect(accepted).toHaveLength(1);
    expect(refused.length).toBeGreaterThanOrEqual(1);
    for (const item of refused) expect(item.reason_codes).toEqual(["COOLDOWN_ACTIVE"]);
  } finally {
    await close();
  }
});
