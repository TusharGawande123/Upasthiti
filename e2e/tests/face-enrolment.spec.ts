// M3 face enrolment in a real browser (spec AC-1 to AC-8, design gate B). The backend runs with
// FACE_ENGINE=fake and the browser's camera plays a clip of a made-up person holding the five
// poses (backend/app/scripts/e2e_face_video.py): no real face is used. Plants and people are
// made through the admin API; the Super Admin then enrols a face with the consent dialog and the
// wizard, and the Corporate Head and Plant Head can only look.
import { expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  assignPlant,
  CORPORATE_HEAD_LOGIN,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makePermanentEmployee,
  makePlant,
  openAdminWithFaceCamera,
  PLANT_HEAD_LOGIN,
  SUPER_ADMIN_LOGIN,
  setPrivacySettings,
  takeShotWhenCameraShows,
} from "./helpers";

// The tests share one database: this file makes its own plant and runs in order.
test.describe.configure({ mode: "serial" });

const ENROLLED_NAME = "Meera Joshi";
const DECLINED_NAME = "Nikhil Rao";
let enrolledId = "";
let declinedId = "";

// Logging in sends the form and moves on; wait for the welcome page before going elsewhere.
async function signIn(page: Page, login: string) {
  await logIn(page, login);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
}

test("set-up: a plant, the privacy settings and two permanent employees", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "PF1");
  await setPrivacySettings(api);
  enrolledId = (await makePermanentEmployee(api, plant, "PF-101", ENROLLED_NAME)).id;
  declinedId = (await makePermanentEmployee(api, plant, "PF-102", DECLINED_NAME)).id;
  await assignPlant(api, PLANT_HEAD_LOGIN, plant.id);
});

test("consent, then five shots, enrol the face", async () => {
  test.setTimeout(240_000);
  const { page, close } = await openAdminWithFaceCamera(5, SUPER_ADMIN_LOGIN);
  try {
    await page.goto(`/admin/employees/${enrolledId}`);
    await expect(page.getByText("Face recognition")).toBeVisible();
    await expect(page.getByText("Consent not recorded yet.")).toBeVisible();
    await page.getByRole("button", { name: "Enrol face" }).click();

    // The consent text comes first; the camera stays off until the employee agrees.
    const consent = page.getByRole("dialog", { name: "Face attendance consent" });
    await expect(consent.getByText("Camera off")).toBeVisible();
    await expect(consent.getByText(/5 pictures/)).toBeVisible();
    await expect(consent.getByRole("button", { name: "I agree" })).toBeEnabled();
    await expectNoSeriousAccessibilityIssues(page);
    await consent.getByRole("button", { name: "I agree" }).click();

    // Camera check, then the five poses; each shot is taken when the clip shows that pose.
    const wizard = page.getByRole("dialog", { name: "Enrol face" });
    await expect(wizard.getByText("Check the camera and the light")).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);
    await wizard.getByRole("button", { name: "Start" }).click();
    for (const [index, pose] of (["straight", "left", "right", "up", "down"] as const).entries()) {
      await expect(wizard.getByText(`Shot ${index + 1} of 5`)).toBeVisible();
      await takeShotWhenCameraShows(page, pose);
      // The fifth accepted shot goes straight on to saving, so it has no dot to look at.
      if (index < 4) await expect(wizard.getByLabel(`Shot ${index + 1}: accepted`)).toBeVisible();
    }

    await expect(wizard.getByText(`Face enrolled for ${ENROLLED_NAME}`)).toBeVisible();
    await expect(wizard.getByText(/5 shots accepted/)).toBeVisible();
    await wizard.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText(/^Enrolled on .* · 5 shots\.$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-enrol face" })).toBeVisible();
    await expectNoSeriousAccessibilityIssues(page);
  } finally {
    await close();
  }
});

test("the Corporate Head and the Plant Head see the face status but cannot change it", async ({
  browser,
}) => {
  for (const login of [CORPORATE_HEAD_LOGIN, PLANT_HEAD_LOGIN]) {
    const context = await browser.newContext({ baseURL: FRONTEND_URL });
    const page = await context.newPage();
    try {
      await signIn(page, login);
      await page.goto(`/admin/employees/${enrolledId}`);
      await expect(page.getByText("Face recognition")).toBeVisible();
      await expect(page.getByText(/^Enrolled on .* · 5 shots\.$/)).toBeVisible();
      for (const name of ["Re-enrol face", "Delete face data", "Withdraw consent"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test("the employee list shows the Face column and the Face filter", async ({ page }) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.goto("/admin/employees");
  const enrolledRow = page.getByRole("row", { name: /PF-101/ });
  await expect(enrolledRow.getByText("Enrolled", { exact: true })).toBeVisible();
  const notEnrolledRow = page.getByRole("row", { name: /PF-102/ });
  await expect(notEnrolledRow.getByText("Not enrolled")).toBeVisible();

  await page.getByLabel("Face", { exact: true }).selectOption("enrolled");
  await expect(page.getByRole("row", { name: /PF-101/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /PF-102/ })).toHaveCount(0);
});

test("withdrawing consent deletes the face and moves the employee to a QR card", async ({
  page,
}) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.goto(`/admin/employees/${enrolledId}`);
  await page.getByRole("button", { name: "Withdraw consent" }).click();
  const dialog = page.getByRole("dialog", { name: `Withdraw face consent of ${ENROLLED_NAME}?` });
  await dialog.getByRole("button", { name: "Withdraw consent" }).click();

  await expect(
    page.getByText(`Consent withdrawn. ${ENROLLED_NAME} now punches with a QR card.`),
  ).toBeVisible();
  await expect(page.getByText("This employee punches with a QR card.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Issue QR card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-enrol face" })).toHaveCount(0);
});

test("'No, I prefer a QR card' switches the employee to a QR card without any camera", async ({
  page,
}) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.goto(`/admin/employees/${declinedId}`);
  await page.getByRole("button", { name: "Enrol face" }).click();
  await page.getByRole("button", { name: "No, I prefer a QR card" }).click();

  await expect(page.getByText("QR card chosen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Issue QR card" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByText("This employee punches with a QR card.")).toBeVisible();
});

test("the consent dialog and the wizard fit a small phone", async () => {
  const { page, close } = await openAdminWithFaceCamera(6, SUPER_ADMIN_LOGIN, {
    width: 360,
    height: 640,
  });
  try {
    const api = adminApi(page);
    const plant = await makePlant(api, "PF2");
    const narrow = await makePermanentEmployee(api, plant, "PF-201", "Kavya Desai");
    await page.goto(`/admin/employees/${narrow.id}`);
    const fits = async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    await fits();
    await page.getByRole("button", { name: "Enrol face" }).click();
    await expect(page.getByRole("button", { name: "I agree" })).toBeVisible();
    await fits();
    await page.getByRole("button", { name: "I agree" }).click();
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await fits();
  } finally {
    await close();
  }
});
