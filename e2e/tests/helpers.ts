// Shared helpers for the end-to-end tests: logging in as the fake users made by e2e_seed,
// and the accessibility scan (spec S-17).
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Fake values from backend/app/scripts/e2e_seed.py (public, test database only).
export const E2E_PASSWORD = "E2e-Test-Password-1";
export const SUPER_ADMIN_LOGIN = "e2e.super";
export const CORPORATE_HEAD_LOGIN = "e2e.corporate";

export async function logIn(page: Page, login: string, password = E2E_PASSWORD) {
  await page.goto("/admin/login");
  await page.getByLabel("Username or email").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Fails the test when the page has a "serious" or "critical" accessibility problem. */
export async function expectNoSeriousAccessibilityIssues(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => `${violation.id}: ${violation.nodes.length} element(s)`),
  ).toEqual([]);
}
