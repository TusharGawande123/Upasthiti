// M3 admin face views in a real browser (spec AC-24, AC-36, AC-38; design gate C, decision 0020):
// the Privacy card of the Settings and the public /privacy page, the dashboard card "Face
// enrolment" with the "Not enrolled" list, the Ctrl+K "Enrol face…" command, and the punch log
// of a code-path face punch with the score details for the Super Admin only. Faces are made-up
// (FACE_ENGINE=fake, the gate's camera is painted by the test); no real face is used.
import { expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  assignPlant,
  CORPORATE_HEAD_LOGIN,
  enrolFaceThroughApi,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makeKioskCode,
  makePermanentEmployee,
  makePlant,
  openGateWithPaintedFace,
  PLANT_HEAD_LOGIN,
  punchWithFace,
  SUPER_ADMIN_LOGIN,
  type TestPlant,
} from "./helpers";

// The tests share one database: this file makes its own plant and runs in order.
test.describe.configure({ mode: "serial" });

const ADDRESS = "Plot 1, MIDC Waluj, Chhatrapati Sambhajinagar";
const CONTACT = "E2E Privacy Officer, privacy@example.invalid";
let plant: TestPlant;
let api: ReturnType<typeof adminApi>;

async function signIn(page: Page, login = SUPER_ADMIN_LOGIN) {
  await logIn(page, login);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  api = adminApi(page);
}

test("the Super Admin sets the privacy texts, and the public notice shows them without a login", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto("/admin/settings");
  const card = page.locator("#privacy");
  await expect(card.getByText("Set this before the first enrolment:")).toBeVisible();
  await card.getByLabel("Company address").fill(ADDRESS);
  await card.getByLabel("Privacy contact (grievance officer)").fill(CONTACT);
  await expect(card.getByText(`${ADDRESS.length} / 300 · at least 5`)).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("End-to-end test set-up");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // Anyone can read the notice: a new browser window with no login.
  const reader = await browser.newContext({ baseURL: FRONTEND_URL });
  const notice = await reader.newPage();
  await notice.goto("/privacy");
  await expect(
    notice.getByRole("heading", { name: "Face and photo attendance at Sheet Shapers" }),
  ).toBeVisible();
  await expect(notice.getByText(CONTACT)).toBeVisible();
  await expect(notice.getByText(/Plot 1, MIDC Waluj/).first()).toBeVisible();
  await expectNoSeriousAccessibilityIssues(notice);
  await reader.close();
});

test("the face settings are shown in sub-groups with a warning when a threshold is lowered", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Face recognition" })).toBeVisible();
  // The accuracy run of 27/10/2026 suggests 0.425 for the match threshold (decision 0024).
  await expect(page.getByText("The report values come from the accuracy report.")).toBeVisible();
  await expect(page.getByText("Report value: 0.425")).toBeVisible();
  const threshold = page.getByLabel("Face match threshold");
  await threshold.fill("0.30");
  await expect(page.getByText("A lower threshold lets more strangers through.")).toBeVisible();
  const floor = page.getByLabel("Ask-for-code floor");
  await floor.fill("0.60");
  await expect(
    page.getByText("The code-entry floor must be lower than the match threshold."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard" }).click();
});

test("the dashboard card counts the enrolled faces and links to the people not enrolled yet", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  plant = await makePlant(api, "AF1");
  const first = await makePermanentEmployee(api, plant, "AF-101", "Meera Kale");
  const second = await makePermanentEmployee(api, plant, "AF-102", "Nikhil Pawar");
  await makePermanentEmployee(api, plant, "AF-103", "Omkar Deshmukh");
  await enrolFaceThroughApi(page, api, first.id, 1);
  await enrolFaceThroughApi(page, api, second.id, 2);
  await assignPlant(api, PLANT_HEAD_LOGIN, plant.id);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Face enrolment" })).toBeVisible();
  await expect(page.getByText("of 3 enrolled")).toBeVisible(); // one plant: no plant list
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("link", { name: /See employees not enrolled/ }).click();
  await expect(page.getByLabel("Face", { exact: true })).toHaveValue("not_enrolled");
  await expect(page.getByRole("row", { name: /AF-103/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /AF-101/ })).toHaveCount(0);
});

test("Ctrl+K 'Enrol face…' opens the consent dialog of the chosen employee", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByText("Enrol face…").click();
  await palette.getByPlaceholder("Type an employee's code or name…").fill("AF-103");
  await expect(palette.getByText("Not enrolled")).toBeVisible();
  await palette.getByText("Omkar Deshmukh").click();

  await expect(page).toHaveURL(/\/admin\/employees\/.+/);
  await expect(page.getByRole("dialog", { name: "Face attendance consent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I agree" })).toBeEnabled();
});

test("the punch log shows a code-path face punch, with the scores for the Super Admin only", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const code = await makeKioskCode(api, plant, "Admin face gate");
  // Face 14 looks like both enrolled faces: the server asks for the code, then accepts AF-101.
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, 14);
  try {
    await punchWithFace(device, setHead);
    await expect(device.getByRole("heading", { name: "Type your employee code" })).toBeVisible({
      timeout: 15_000,
    });
    await device.keyboard.type("AF-101");
    await device.getByRole("button", { name: "OK" }).click();
    await expect(device.getByText("Meera Kale")).toBeVisible({ timeout: 15_000 });
  } finally {
    await close();
  }

  await page.goto("/admin/punches");
  const row = page.getByRole("row", { name: /Unknown face/ }); // the row that asked for the code
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: /Then: By code/ })).toBeVisible();
  const answered = page.getByRole("row", { name: /Meera Kale/ });
  await expect(answered.getByText("Face", { exact: true })).toBeVisible();
  await expect(answered.getByRole("button", { name: /After: Asked for code/ })).toBeVisible();

  await answered.getByRole("button", { name: /Details of the punch/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Match score")).toBeVisible();
  await expect(sheet.getByText("Code typed: AF-101")).toBeVisible();
  await expect(sheet.getByText("Employee code (1:1)")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
});

test("the Corporate Head and the Plant Head see the method and result, but no scores", async ({
  browser,
}) => {
  for (const login of [CORPORATE_HEAD_LOGIN, PLANT_HEAD_LOGIN]) {
    const context = await browser.newContext({ baseURL: FRONTEND_URL });
    const page = await context.newPage();
    try {
      await signIn(page, login);
      await page.goto("/admin/punches");
      const answered = page.getByRole("row", { name: /Meera Kale/ });
      await expect(answered).toBeVisible();
      await expect(answered.getByRole("button", { name: /View photo/ })).toHaveCount(0);
      await answered.getByRole("button", { name: /Details of the punch/ }).click();
      const sheet = page.getByRole("dialog");
      await expect(
        sheet.getByText("Scores, the typed code and photos are shown to the Super Admin only."),
      ).toBeVisible();
      await expect(sheet.getByText("Match score")).toHaveCount(0);
      await expect(sheet.getByText("Code typed: AF-101")).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
