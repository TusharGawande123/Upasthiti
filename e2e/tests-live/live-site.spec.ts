// Read-only checks of the live site after a deploy: the API answers through Vercel, the
// database is reachable, and the login page loads.
import { expect, test } from "@playwright/test";

test("API answers through the website address and the database is ready", async ({ request }) => {
  const ready = await request.get("/api/v1/health/ready", { timeout: 60_000 });
  expect(ready.ok()).toBe(true);
  expect(await ready.json()).toMatchObject({ status: "ok", database: "ok" });
});

test("login page loads", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("button", { name: /log in/i })).toBeVisible({ timeout: 60_000 });
});
