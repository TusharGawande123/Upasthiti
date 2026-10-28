// M4: the gate's location on every punch, in a real browser (spec M4 §4.1, AC-1, AC-2, AC-4).
// The browser's location is moved with Playwright: outside the fence the gate pauses with
// "This attendance device needs its location" and comes back by itself; a punch at the edge of
// the fence counts and is flagged for the Super Admin.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  FAR_AWAY,
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
// makePlant draws a square 0.002 degrees (about 222 m) on each side of INSIDE, margin 25 m.
const METRES_PER_DEGREE_LAT = 111_195;
const AT_THE_EDGE = { ...INSIDE, latitude: INSIDE.latitude + 0.002 + 18 / METRES_PER_DEGREE_LAT };

let plant: TestPlant;

async function setUp(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  plant ??= await makePlant(api, "PL1");
  return api;
}

test("outside the fence the gate pauses, and it resumes by itself when the location is good", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const api = await setUp(page);
  const card = await makeWorkerWithCard(api, plant, "PL-101", "Kiran Jadhav");
  const code = await makeKioskCode(api, plant, "Location gate");

  const { device, close } = await openKioskWithCard(card.serial, code, undefined, {
    tapReady: false,
  });
  try {
    await expect(device.getByText(/^Location good \(±\d+ m\)$/)).toBeVisible({ timeout: 20_000 });

    await device.context().setGeolocation(FAR_AWAY);
    await expect(
      device.getByRole("heading", { name: "This attendance device needs its location" }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(device.getByText("LOCATION_OUTSIDE")).toBeVisible();
    await expect(device.getByText(/outside the fence$/)).toBeVisible();
    await expect(device.getByText("Checking again…")).toBeVisible();

    await device.context().setGeolocation(INSIDE);
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible({
      timeout: 45_000,
    });
  } finally {
    await close();
  }
});

test("a punch at the edge of the fence shows IN and is flagged for review", async ({ page }) => {
  test.setTimeout(150_000);
  const api = await setUp(page);
  const card = await makeWorkerWithCard(api, plant, "PL-102", "Meena Shinde");
  const code = await makeKioskCode(api, plant, "Edge gate");

  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    await expect(device.getByText(/^Location good/)).toBeVisible({ timeout: 20_000 });
    await device.context().setGeolocation(AT_THE_EDGE);
    await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(device.getByText("Meena Shinde")).toBeVisible();

    const log = await api.get<{ items: Array<{ decision: string; reason_codes: string[] }> }>(
      `/punches?plant_id=${plant.id}&q=PL-102`,
    );
    expect(log.items[0]?.decision).toBe("flagged");
    expect(log.items[0]?.reason_codes).toEqual(["LOCATION_AT_EDGE"]);
  } finally {
    await close();
  }
});
