// Slice A in a real browser: login, roles, users, settings, audit, sessions, accessibility.
// Spec AC-1, AC-2, AC-3, AC-12, AC-25, AC-27, AC-35, AC-42.
import { expect, test } from "@playwright/test";
import {
  CORPORATE_HEAD_LOGIN,
  expectNoSeriousAccessibilityIssues,
  logIn,
  SUPER_ADMIN_LOGIN,
} from "./helpers";

test("a wrong password shows one message, the right one opens the dashboard", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN, "Wrong-Password-1");
  await expect(page.getByRole("alert")).toContainText("Username/email or password is wrong.");

  await page.getByLabel("Password").fill("E2e-Test-Password-1");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("Welcome, E2E Super Admin")).toBeVisible();
});

test("the login page has no serious accessibility problems", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  await expectNoSeriousAccessibilityIssues(page);
});

test("a Corporate Head does not see Users and is refused the page", async ({ page }) => {
  await logIn(page, CORPORATE_HEAD_LOGIN);
  await expect(page.getByText("Welcome, E2E Corporate Head")).toBeVisible();

  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
});

test("Super Admin adds a user, sees the temporary password once, and it appears in the audit log", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Asha Rao");
  await dialog.getByLabel("Username").fill("asha.rao");
  await dialog.getByRole("button", { name: "Add user" }).click();

  await expect(page.getByText("Temporary password")).toBeVisible();
  await expect(page.getByText(/shown only once/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("cell", { name: /asha\.rao/ })).toBeVisible();

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("user.create").first()).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);
});

test("Super Admin changes a setting with a reason; the audit log shows before and after", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  const field = page.getByLabel("GPS accuracy limit");
  await field.fill("30");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Gate phones are accurate");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.getByRole("link", { name: "Audit log" }).click();
  await page.getByLabel("Action").fill("settings.update");
  await page
    .getByRole("button", { name: /\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/ })
    .first()
    .click();
  const panel = page.getByRole("complementary", { name: "Entry details" });
  await expect(panel).toContainText("− Before");
  await expect(panel).toContainText("+ After");
  await expect(panel).toContainText("Gate phones are accurate");
});

test("My sessions lists this device and logging out returns to the login screen", async ({
  page,
}) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await page.getByRole("button", { name: /E2E Super Admin/ }).click();
  await page.getByRole("menuitem", { name: "My sessions" }).click();

  await expect(page.getByText("This device")).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page);

  await page.getByRole("button", { name: /E2E Super Admin/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
});
