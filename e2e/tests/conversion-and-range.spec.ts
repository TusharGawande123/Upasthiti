// M5c in a real browser: a temporary worker becomes permanent (the Super Admin at once, a Corporate
// Head through the approvals inbox), the "Face enrolment pending" banner and the type history show,
// and the attendance of any period is read day by day and downloaded. Spec M5c AC-13, AC-14,
// AC-22, AC-4, AC-7.
import { expect, type Page, test } from "@playwright/test";
import {
  adminApi,
  CORPORATE_HEAD_LOGIN,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makePlant,
  SUPER_ADMIN_LOGIN,
} from "./helpers";

// One database for all files: this file makes its own plant and runs its tests in order.
test.describe.configure({ mode: "serial" });

const workers: Record<string, { id: string; name: string }> = {};

function daysAgo(count: number): string {
  const day = new Date();
  day.setDate(day.getDate() - count);
  return day.toISOString().slice(0, 10);
}

/** Logs in and waits until the admin site has opened (the user menu shows), so a later page.goto
 * keeps the session. */
async function signIn(page: Page, login: string) {
  await logIn(page, login);
  await expect(page.getByRole("button", { name: /E2E/ })).toBeVisible();
}

async function logOut(page: Page) {
  await page.getByRole("button", { name: /E2E/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
}

test("a Super Admin makes a plant with two temporary workers", async ({ page }) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  const api = adminApi(page);
  const plant = await makePlant(api, "CV1");
  // Attendance counts from this day (a new plant has none until the Super Admin sets it).
  await api.patch(`/plants/${plant.id}`, { attendance_start_date: daysAgo(10) });
  for (const [key, code, name] of [
    ["direct", "CV-01", "Sunil More"],
    ["asked", "CV-02", "Kavita Joshi"],
  ] as const) {
    const created = await api.post<{ id: string }>("/employees", {
      employee_code: code,
      full_name: name,
      type: "temporary",
      plant_id: plant.id,
      category_id: plant.helperId,
      shift_id: plant.shiftId,
      hourly_rate: "85.00",
      joined_on: daysAgo(10),
    });
    workers[key] = { id: created.id, name };
  }
  expect(Object.keys(workers)).toHaveLength(2);
});

test("the Super Admin converts a temporary worker and sees what follows", async ({ page }) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  const worker = workers.direct;
  await page.goto(`/admin/employees/${worker?.id}`);
  await page.getByRole("button", { name: "Convert to permanent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/cannot punch until the Super Admin/)).toBeVisible();
  await dialog.getByLabel("Reason").fill("Permanent offer from HR");
  await dialog.getByRole("button", { name: "Convert to permanent" }).click();

  await expect(dialog.getByText("Converted to permanent")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enrol face now" })).toBeVisible();
  await dialog.getByRole("button", { name: "Later" }).click();

  await expect(page.getByText("Face enrolment pending").first()).toBeVisible();
  await expect(page.getByText("Converted", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Type history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert to permanent" })).toHaveCount(0);
  await expectNoSeriousAccessibilityIssues(page);

  // The urgent notice reached the Super Admin; it carries no name.
  await page.goto("/admin/notifications");
  await expect(page.getByText(/became permanent/).first()).toBeVisible();
  await expect(page.getByText(/Sunil/)).toHaveCount(0);
});

test("a Corporate Head asks for a conversion and the Super Admin approves it", async ({ page }) => {
  await signIn(page, CORPORATE_HEAD_LOGIN);
  const worker = workers.asked;
  await page.goto(`/admin/employees/${worker?.id}`);
  await page.getByRole("button", { name: "Ask for conversion" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Permanent offer from HR");
  await dialog.getByRole("button", { name: "Ask for conversion" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  // Nothing changed yet for the worker; the request waits.
  await expect(page.getByText("Face enrolment pending")).toHaveCount(0);
  await logOut(page);

  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: /Approvals/ }).click();
  await page
    .getByText(/Convert Kavita Joshi/)
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await page.goto(`/admin/employees/${worker?.id}`);
  await expect(page.getByText("Face enrolment pending").first()).toBeVisible();
});

test("the register is read for any period and downloaded as Excel", async ({ page }) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.goto("/admin/attendance/register");
  await page.getByRole("button", { name: "Date range" }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByText(/days\)/)).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toContain("register-");
});

test("one employee is read day by day for a period and the print sheet downloads", async ({
  page,
}) => {
  await signIn(page, SUPER_ADMIN_LOGIN);
  await page.goto(`/admin/employees/${workers.direct?.id}?tab=attendance`);
  await expect(page.getByText("Day by day for a period")).toBeVisible();
  await page.getByRole("button", { name: "Last 30 days" }).last().click();
  // The Type column shows because the type changed inside the period.
  await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Print sheet (PDF)" }).click(),
  ]);
  expect(download.suggestedFilename()).toContain("attendance-");
});
