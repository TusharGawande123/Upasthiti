// Playwright settings for the short check of the LIVE site after each deploy (spec S-18).
// It starts no servers: it opens LIVE_SITE_URL. Read-only: it never logs in or changes data.
import { defineConfig, devices } from "@playwright/test";

const liveSiteUrl = process.env.LIVE_SITE_URL;
if (!liveSiteUrl) {
  throw new Error("Set LIVE_SITE_URL to the Vercel address, e.g. https://upasthiti.vercel.app");
}

export default defineConfig({
  testDir: "./tests-live",
  retries: 2, // the free backend may still be waking up
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: liveSiteUrl,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "off", // CI artifacts are public
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
