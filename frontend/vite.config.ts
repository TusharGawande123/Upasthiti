// Vite settings: React, Tailwind, the /api proxy for local development, the app version, and Vitest.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// Writes dist/version.json = { "version": "<this build>" }. A running kiosk reads it every
// 5 minutes and reloads itself into a newer build when it is idle (S-27).
function versionFile(version: string): Plugin {
  return {
    name: "upasthiti-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version })}
`,
      });
    },
  };
}

// M4 (spec §7 rule 13): the gate page loads without internet after a reload or a power cut.
// The service worker is registered ONLY by the gate page (src/kiosk/offline/register-sw.ts) and
// its scope is /attendance, so the admin website is never controlled or cached by it.
//  - the page shell (index.html) is precached and answers navigations to /attendance;
//  - hashed scripts, styles, fonts, the QR decoder and the face guide are cached the first time
//    the gate loads them (they never change under the same name);
//  - /api/* and /version.json are never cached: punches and the self-update need the network.
function gateServiceWorker() {
  return VitePWA({
    // The gate page registers it itself; nothing is added to the admin pages.
    injectRegister: null,
    registerType: "autoUpdate",
    manifest: {
      name: "Gate attendance",
      short_name: "Gate",
      description: "Upasthiti gate attendance for the attendance device at the plant gate.",
      start_url: "/attendance",
      scope: "/attendance",
      display: "fullscreen",
      background_color: "#f8fafc",
      theme_color: "#f8fafc",
    },
    workbox: {
      globPatterns: ["index.html"],
      navigateFallback: "/index.html",
      navigateFallbackAllowlist: [/^\/attendance/, /^\/kiosk/],
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      // A new worker takes over at once; the gate itself reloads when idle (S-27).
      skipWaiting: true,
      clientsClaim: true,
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.pathname.startsWith("/assets/"),
          handler: "CacheFirst",
          options: {
            cacheName: "gate-assets",
            expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 90 },
          },
        },
        {
          urlPattern: ({ url }) =>
            url.pathname.startsWith("/models/") || url.pathname.startsWith("/locales/"),
          handler: "StaleWhileRevalidate",
          options: { cacheName: "gate-data" },
        },
      ],
    },
  });
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  // In development the browser calls /api/... on the Vite server, which forwards it to the
  // backend. In production Vercel does the same (M1). So the app always uses one origin.
  const apiProxyTarget = environment.VITE_API_PROXY_TARGET || "http://localhost:8000";
  // The build's version: set by hand, or Vercel's commit id; "dev" on a laptop (never updates).
  const appVersion =
    environment.VITE_APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "dev";

  return {
    plugins: [react(), tailwindcss(), versionFile(appVersion), gateServiceWorker()],
    define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion) },
    // "@/..." means "frontend/src/..." (same as tsconfig paths; used by shadcn/ui components).
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    // Pages are loaded lazily (src/app/router.tsx). Without this, the dev server finds some
    // libraries only when a page is first opened, prepares them and reloads the browser in the
    // middle of what you were doing (and of end-to-end tests). Scanning every source file at
    // start-up prepares them all at once. Development only; the production build is unchanged.
    optimizeDeps: { entries: ["index.html", "src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"] },
    server: {
      port: 5173,
      proxy: { "/api": { target: apiProxyTarget, changeOrigin: true } },
    },
    test: {
      environment: "jsdom",
      globals: true,
      // Form tests type many characters; under coverage a laptop needs more than the default 5 s.
      testTimeout: 15_000,
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/main.tsx",
          "src/test/**",
          "src/**/*.test.{ts,tsx}",
          // The Leaflet map cannot run in jsdom; the end-to-end test draws on it for real.
          "src/features/plants/geofence-map.tsx",
        ],
        reporter: ["text", "json-summary"],
        // Coverage floor: 60% in M0, 70% from M1, 75% from M2, 80% from M3; raised in each milestone (spec S-8).
        thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  };
});
