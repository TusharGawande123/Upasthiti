// Smoke test: the whole chain works (browser -> Vite /api proxy -> FastAPI) and the main
// routes render. Spec AC-1, AC-7, AC-8.
import { expect, test } from "@playwright/test";

test("admin page shows that the server is connected", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByText("Server connected")).toBeVisible();
  await expect(page.getByText(/Server time: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} IST/)).toBeVisible();
});

test("the home address opens the admin page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/admin$/);
});

test("kiosk placeholder renders", async ({ page }) => {
  await page.goto("/kiosk");

  await expect(page.getByRole("heading", { name: "Upasthiti Kiosk" })).toBeVisible();
});

test("unknown address shows 'Page not found'", async ({ page }) => {
  await page.goto("/no-such-page");

  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
