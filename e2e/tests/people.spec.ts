// Slice D in a real browser: a Corporate Head's employee change waits for the Super Admin,
// the approval applies it, the palette finds the person, import checks a file, a person is
// marked as left, and every page passes the accessibility scan. Spec AC-9, AC-10, AC-18..AC-23,
// AC-32, AC-33.
import { expect, type Page, test } from "@playwright/test";
import {
  CORPORATE_HEAD_LOGIN,
  expectNoSeriousAccessibilityIssues,
  logIn,
  SUPER_ADMIN_LOGIN,
} from "./helpers";

// One database for all files: this file makes its own plant and runs its tests in order.
test.describe.configure({ mode: "serial" });

async function logOut(page: Page) {
  await page.getByRole("button", { name: /E2E/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
}

test("Super Admin adds a plant and a contractor for the people tests", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Plants" }).click();
  await page.getByRole("button", { name: "Add a plant" }).first().click();
  const plantDialog = page.getByRole("dialog");
  await plantDialog.getByLabel("Code").fill("ET1");
  await plantDialog.getByLabel("Name").fill("People Test Plant");
  await plantDialog.getByRole("button", { name: "Add a plant" }).click();
  await expect(page.getByRole("heading", { name: "People Test Plant" })).toBeVisible();

  await page.getByRole("link", { name: "Contractors" }).click();
  await expectNoSeriousAccessibilityIssues(page);
  await page.getByRole("button", { name: "Add contractor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Agency").fill("Shree Manpower");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Shree Manpower", exact: true })).toBeVisible();
});

test("a Corporate Head's new employee waits; the Super Admin approves it and it appears", async ({
  page,
}) => {
  await logIn(page, CORPORATE_HEAD_LOGIN);
  await page.getByRole("link", { name: "Employees" }).click();
  await expect(page.getByText(/Your changes wait for the Super Admin/)).toBeVisible();
  await page.getByRole("button", { name: "Add employee" }).click();

  await page
    .getByLabel("Plant", { exact: true })
    .selectOption({ label: "ET1 · People Test Plant" });
  await page.getByLabel("Code", { exact: true }).fill("et-001");
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel("Category").selectOption({ label: "Staff" });
  await page.getByLabel("Shift").selectOption({ index: 1 });
  await expectNoSeriousAccessibilityIssues(page);
  await page.getByRole("button", { name: "Send for approval" }).click();

  // Nothing is created yet: the list does not show the person.
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ET-001" })).toHaveCount(0);
  await page.getByRole("link", { name: "My requests" }).first().click();
  await expect(page.getByText(/Add Asha Rao/)).toBeVisible();
  await expect(page.getByText("Waiting").first()).toBeVisible();
  await logOut(page);

  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("link", { name: /Approvals/ })).toContainText("1");
  await page.getByRole("link", { name: /Approvals/ }).click();
  await expectNoSeriousAccessibilityIssues(page);
  await page
    .getByText(/Add Asha Rao/)
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Nothing has changed yet.")).toBeVisible();
  await drawer.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing is waiting")).toBeVisible();

  await page.getByRole("link", { name: "Employees" }).click();
  await expect(page.getByRole("cell", { name: "ET-001" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
});

test("the Ctrl+K palette finds the person and the timeline shows who added them", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByText("Welcome, E2E Super Admin")).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByPlaceholder("Search employees, plants, pages…").fill("Asha");
  await palette.getByText("Asha Rao").click();

  await expect(page.getByRole("heading", { name: "Asha Rao" })).toBeVisible();
  await expect(page.getByText("Added", { exact: true })).toBeVisible();
  await expect(page.getByText(/approved by the Super Admin/)).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
});

test("a Super Admin marks the person as left; the history stays and nothing can be deleted", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Employees" }).click();
  await page.getByRole("link", { name: "Asha Rao" }).first().click();
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark as left" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Resigned");
  await dialog.getByRole("button", { name: "Mark as left" }).click();

  await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
  await expect(page.getByText("Marked as left", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Employees" }).first().click();
  await expect(page.getByRole("cell", { name: "ET-001" })).toHaveCount(0); // not in "Active"
});

test("the import wizard checks the template file before saving anything", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Import" }).click();
  await expectNoSeriousAccessibilityIssues(page);

  // The template downloads and is accepted as a real Excel file by the dry run.
  const template = await page.request.get("/api/v1/employees/import/template.xlsx");
  expect(template.ok()).toBe(true);
  await page.getByLabel("Choose an Excel file").setInputFiles({
    name: "template.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await template.body(),
  });

  await expect(page.getByText(/rows are fine/)).toBeVisible();
  await expect(page.getByText(/rows have errors/)).toBeVisible();
});

test("the employee list needs a login", async ({ page }) => {
  await page.goto("/admin/employees");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
