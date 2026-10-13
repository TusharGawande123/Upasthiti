// Smoke test: the whole chain works (browser -> Vite /api proxy -> FastAPI -> Postgres) and
// the main routes render. Spec AC-1, AC-7, AC-8.
import { expect, test } from "@playwright/test";
import { logIn, SUPER_ADMIN_LOGIN } from "./helpers";

test("dashboard shows that the server is connected after logging in", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);

  await expect(page.getByText("Server connected")).toBeVisible();
  await expect(page.getByText(/Server time: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} IST/)).toBeVisible();
});

test("dashboard says the server is not reachable when the API is down", async ({ page }) => {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByText("Server connected")).toBeVisible();
  await page.route("**/api/v1/health", (route) => route.abort());

  await page.reload();

  await expect(page.getByText("Server not reachable. Is the backend running?")).toBeVisible({
    timeout: 10_000, // the app retries once before showing the error
  });
});

test("the home address opens the login screen when nobody is logged in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("kiosk placeholder renders", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(page.getByRole("heading", { name: "Upasthiti Kiosk" })).toBeVisible();
});

test("unknown address shows 'Page not found'", async ({ page }) => {
  await page.goto("/no-such-page");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
