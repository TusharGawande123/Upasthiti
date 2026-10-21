// Slice C in real browsers (spec M2 §4.10 to §4.12, AC-5, AC-23, AC-24, AC-30, AC-31, AC-36, AC-37):
// the punch log with a real photo and an Excel export, a Plant Head who writes a gate notice that
// shows on the kiosk and prints the poster but cannot print cards, and a bulk card issue with the
// A4 print. Every new admin page gets an accessibility scan. Data is made through the admin API.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  assignPlant,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  PLANT_HEAD_LOGIN,
  SUPER_ADMIN_LOGIN,
  type TestPlant,
} from "./helpers";

// The tests share one database: this file makes its own plant and runs in order.
test.describe.configure({ mode: "serial" });

// A card clip repeats every 21.5 s; a scan and its result need a little longer.
const NEXT_SCAN = { timeout: 45_000 };
const WORKER = { code: "AP-101", name: "Meera Joshi" };
let plant: TestPlant;
let cardSerial: string;

async function openAsSuperAdmin(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  return adminApi(page);
}

test("the first punch at the gate shows in the punch log, with its photo, and exports", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await openAsSuperAdmin(page);
  plant = await makePlant(api, "AP1");
  const card = await makeWorkerWithCard(api, plant, WORKER.code, WORKER.name);
  cardSerial = card.serial;
  const code = await makeKioskCode(api, plant, "Admin test gate");

  // A real punch, made at a kiosk whose camera shows the card.
  const { device, close } = await openKioskWithCard(card.serial, code);
  try {
    await expect(device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
  } finally {
    await close();
  }

  // The Super Admin finds it in the punch log.
  await page.getByRole("link", { name: "Punch log" }).click();
  await expect(page.getByRole("heading", { name: "Punch log" })).toBeVisible();
  await page.getByLabel("Search by employee code or name").fill(WORKER.code);
  const row = page.getByRole("row", { name: new RegExp(WORKER.name) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Accepted")).toBeVisible();
  await expect(row.getByText("Photo stored")).toBeVisible();
  await expect(page.getByRole("button", { name: /Accepted IN/ })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  // View photo: the real photo the kiosk sent, decrypted by the server, with the audit note.
  await row.getByRole("button", { name: "View photo" }).click();
  const dialog = page.getByRole("dialog");
  const photo = dialog.getByRole("img");
  await expect(photo).toBeVisible();
  await expect
    .poll(async () => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(dialog.getByText("Viewing is recorded in the audit log.")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  // Compare: a card with no earlier photos says so.
  await dialog.getByRole("button", { name: "Compare with earlier punches" }).click();
  await expect(dialog.getByText("This card has no earlier stored photos.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(dialog).toBeHidden();

  // The viewing is in the audit log.
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("snapshot.view").first()).toBeVisible();

  // Export of the day: a real .xlsx file, text only.
  await page.getByRole("link", { name: "Punch log" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export day (.xlsx)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^punches-\d{4}-\d\d-\d\d\.xlsx$/);
});

test("a Plant Head writes a gate notice that shows on the kiosk, and prints the poster", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = await openAsSuperAdmin(page);
  await assignPlant(api, "e2e.plant", plant.id);
  // The pairing code is made now, while the Super Admin is logged in; it lives 10 minutes.
  const gateCode = await makeKioskCode(api, plant, "Notice gate");
  await page.context().clearCookies();

  await logIn(page, PLANT_HEAD_LOGIN);
  await expect(page.getByText("Welcome, E2E Plant Head")).toBeVisible();

  // The Plant Head reads the punch log of their plant, with no photo buttons.
  await page.getByRole("link", { name: "Punch log" }).click();
  await page.getByLabel("Search by employee code or name").fill(WORKER.code);
  const row = page.getByRole("row", { name: new RegExp(WORKER.name) });
  await expect(row.getByText("Photo stored")).toBeVisible();
  await expect(page.getByRole("button", { name: "View photo" })).toHaveCount(0);
  await expect(page.getByText(/Read-only, your plant only/)).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  // A new gate notice for the Plant Head's own plant, with the live preview.
  await page.getByRole("link", { name: "Gate notices" }).click();
  await expect(page.getByRole("heading", { name: "Gate notices" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
  await page.getByRole("button", { name: "New notice" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Shown at")).toBeDisabled();
  await form.getByLabel("Notice text").fill("Safety shoes are required at Gate 1.");
  await form.getByRole("radio", { name: /Important/ }).check();
  const preview = form.getByRole("complementary", { name: "How it looks at the gate" });
  await expect(preview.getByText("Safety shoes are required at Gate 1.")).toBeVisible();
  await expect(preview.getByText("Important")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
  await form.getByRole("button", { name: "Save notice" }).click();
  await expect(form).toBeHidden();
  const listed = page.getByRole("row", { name: /Safety shoes are required at Gate 1\./ });
  await expect(listed.getByText("Showing now")).toBeVisible();
  await expect(listed.getByText("AP1")).toBeVisible();

  // The kiosk of that plant shows it, Important with its word.
  const kiosk = await openKioskWithCard(cardSerial, gateCode);
  try {
    await expect(kiosk.device.getByText("Safety shoes are required at Gate 1.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kiosk.device.getByText("Important", { exact: true })).toBeVisible();
  } finally {
    await kiosk.close();
  }

  // End now: the notice stays in the list as Ended.
  await listed.getByRole("button", { name: "End now" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "End now" }).click();
  await expect(listed.getByText("Ended", { exact: true })).toBeVisible();

  // The Plant Head cannot print cards: the cards page is read-only.
  await page.getByRole("link", { name: "QR cards" }).click();
  await expect(
    page.getByText(/Only the Super Admin issues, prints and revokes cards/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Print|Issue/ })).toHaveCount(0);

  // The poster of their own plant: a real PDF from the server.
  await page.getByRole("link", { name: "Plants" }).click();
  await page.getByRole("link", { name: /AP1/ }).first().click();
  const poster = page.waitForResponse(
    (response) => response.url().includes("/gate-poster.pdf") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Download gate poster (A4 PDF)" }).click();
  expect((await poster).headers()["content-type"]).toContain("application/pdf");
});

test("the Super Admin issues cards to 12 workers at once and opens the A4 print", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await openAsSuperAdmin(page);
  for (let number = 1; number <= 12; number += 1) {
    const employeeCode = `BK-${String(number).padStart(2, "0")}`;
    await api.post("/employees", {
      employee_code: employeeCode,
      full_name: `Bulk Worker ${number}`,
      type: "temporary",
      plant_id: plant.id,
      category_id: plant.helperId,
      shift_id: plant.shiftId,
      hourly_rate: "85.00",
      joined_on: new Date().toISOString().slice(0, 10),
    });
  }

  await page.getByRole("link", { name: "QR cards" }).click();
  await page
    .getByPlaceholder(/Search/)
    .first()
    .fill("BK-");
  await expect(page.getByRole("row", { name: /Bulk Worker 12/ })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("checkbox", { name: "Select everyone on this page" }).check();
  await expect(page.getByText("What each button will do with these 12 people")).toBeVisible();
  await page.getByRole("button", { name: "Issue cards" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Issue cards to 12 people" })).toBeVisible();
  await dialog.getByLabel("Reason").fill("New workers for the e2e test");
  await dialog.getByRole("button", { name: "Issue 12 cards" }).click();
  await expect(dialog.getByRole("heading", { name: "12 cards issued" })).toBeVisible();

  // The A4 print: one PDF for the 12 new cards.
  const pdf = page.waitForResponse(
    (response) => response.url().includes("/qr-cards/print") && response.status() === 200,
  );
  await dialog.getByRole("button", { name: "Print the 12 new cards (A4)" }).click();
  expect((await pdf).headers()["content-type"]).toContain("application/pdf");
});

test("the kiosks and settings pages with the M2 additions have no serious accessibility problems", async ({
  page,
}) => {
  await openAsSuperAdmin(page);

  await page.getByRole("link", { name: "Kiosks" }).click();
  await expect(page.getByRole("switch", { name: "Sound at Admin test gate" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  // The Super Admin switches one gate's sound off; it stays off after a reload.
  const sound = page.getByRole("switch", { name: "Sound at Admin test gate" });
  await sound.click();
  await expect(sound).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Sound at Admin test gate" })).not.toBeChecked();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Kiosk sound and screen")).toBeVisible();
  await expect(page.getByLabel("Default card validity")).toHaveValue("2");
  await expectNoSeriousAccessibilityIssues(page);
});
