// Playwright settings. Before the tests run, Playwright starts the backend and the frontend
// itself, so `npx playwright test` is the only command needed (locally and in CI).
import { defineConfig, devices } from "@playwright/test";
import { BACKEND_ENV, FRONTEND_URL } from "./backend-env";

const isCI = Boolean(process.env.CI);
const BACKEND_URL = "http://localhost:8000";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  // All tests share ONE database (plants, people, kiosks) and every login runs a deliberately
  // slow password hash, so the tests run one after another. That keeps them reliable.
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 10_000 },
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: FRONTEND_URL,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    // Traces hold screenshots and network data. CI artifacts are public, so no traces
    // there (this matters from M2 on: QR snapshots, face frames).
    trace: isCI ? "off" : "retain-on-failure",
  },
  projects: [
    // The admin pages and the gate, on a laptop browser.
    {
      name: "chromium",
      testIgnore: /phone-.*.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // M4b (S-46): the phone pages on a Pixel 7 sized Chromium. The spec paints the camera, sets the
    // location and adds a virtual authenticator (passkeys) itself. An iPhone (WebKit) cannot run the
    // virtual authenticator, so only the Pixel project exists; the iPhone 13 size is checked in
    // responsive.spec.ts.
    {
      name: "phone",
      testMatch: /phone-.*.spec.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      // A real Postgres database, wiped and filled with fake users by e2e_seed before the
      // server starts. Locally: `docker compose up -d`; CI: the job's Postgres service.
      command:
        "uv run python -m app.scripts.e2e_seed && uv run fastapi run app/main.py --port 8000",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/v1/health`,
      // Database, fake secrets, card signing and snapshot keys, local photo folder.
      env: BACKEND_ENV,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      cwd: "../frontend",
      url: FRONTEND_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
