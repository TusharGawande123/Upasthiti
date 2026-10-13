// Vite settings: React, Tailwind, the /api proxy for local development, and Vitest.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  // In development the browser calls /api/... on the Vite server, which forwards it to the
  // backend. In production Vercel does the same (M1). So the app always uses one origin.
  const apiProxyTarget = environment.VITE_API_PROXY_TARGET || "http://localhost:8000";

  return {
    plugins: [react(), tailwindcss()],
    // "@/..." means "frontend/src/..." (same as tsconfig paths; used by shadcn/ui components).
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      port: 5173,
      proxy: { "/api": { target: apiProxyTarget, changeOrigin: true } },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.{ts,tsx}"],
        reporter: ["text", "json-summary"],
        // Coverage floor: 60% in M0, 70% from M1; raised in each milestone (spec S-8).
        thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
      },
    },
  };
});
