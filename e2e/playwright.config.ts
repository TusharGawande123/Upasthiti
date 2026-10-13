// Playwright settings. Before the tests run, Playwright starts the backend and the frontend
// itself, so `npx playwright test` is the only command needed (locally and in CI).
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const FRONTEND_URL = "http://localhost:5173";
const BACKEND_URL = "http://localhost:8000";
// The name must end in _e2e: the seed script refuses any other database.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql+psycopg://upasthiti:upasthiti@127.0.0.1:5432/upasthiti_e2e";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Every login runs a deliberately slow password hash; many workers at once starve a laptop.
  workers: isCI ? 2 : 3,
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // A real Postgres database, wiped and filled with fake users by e2e_seed before the
      // server starts. Locally: `docker compose up -d`; CI: the job's Postgres service.
      command:
        "uv run python -m app.scripts.e2e_seed && uv run fastapi run app/main.py --port 8000",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/v1/health`,
      env: {
        APP_ENV: "test",
        RUN_SCHEDULER: "false",
        DATABASE_URL: E2E_DATABASE_URL,
        // Fake values, used only by these tests.
        APP_SECRET_KEY: "e2e-only-secret-key-not-used-anywhere-else-0123",
        APP_PUBLIC_ORIGIN: FRONTEND_URL,
      },
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
