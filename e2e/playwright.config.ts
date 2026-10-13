// Playwright settings. Before the tests run, Playwright starts the backend and the frontend
// itself, so `npx playwright test` is the only command needed (locally and in CI).
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const FRONTEND_URL = "http://localhost:5173";
const BACKEND_URL = "http://localhost:8000";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
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
      // The smoke test does not need a database: /api/v1/health never opens a connection,
      // so a placeholder DATABASE_URL is enough.
      command: "uv run fastapi run app/main.py --port 8000",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/v1/health`,
      env: {
        APP_ENV: "test",
        DATABASE_URL: "postgresql+psycopg://e2e:e2e@127.0.0.1:1/e2e",
        APP_SECRET_KEY: "e2e-only-secret-key-not-used-anywhere-else-0123",
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
