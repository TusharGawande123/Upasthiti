// M4b lines on the dashboard: "On outside work: N" under "Inside now" and the phone line of the
// "Cards ending soon" card. Also a check of the Vercel header rules for /phone (S-47, AC-58):
// they must come after the catch-all rule so the stricter values win.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vercelText from "../../../vercel.json?raw";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const K134 = { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)", is_demo: false };
const NUMBERS = {
  inside_now: 214,
  inside_temporary: 98,
  on_outside_work: 3,
  expected: 236,
  arrived: 221,
  late: 12,
  not_arrived: 9,
  on_leave: 8,
  off_today: 14,
  exceptions: 11,
  undecided: { short_hours: 3, incomplete: 2 },
};

function base(expiring: object) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: expiring },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    "GET /reviews/summary": { body: { to_check: 0, rejected_last_7_days: 0, by_code: {} } },
    "GET /dashboard/live": {
      body: {
        generated_at: "2026-11-02T04:30:00Z",
        date: "2026-11-02",
        plants: [
          {
            ...NUMBERS,
            plant: K134,
            attendance_started: true,
            by_contractor: [],
            shifts: [],
          },
        ],
        totals: NUMBERS,
      },
    },
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("dashboard lines of phone punching", () => {
  it("shows how many people are on outside work", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ count: 4, days: 14, phone_on_count: 2 }));
    renderRoute("/admin");
    expect(await screen.findByText("On outside work: 3")).toBeInTheDocument();
  });

  it("shows the phone line of Cards ending soon only when there is one", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ count: 4, days: 14, phone_on_count: 2 }));
    renderRoute("/admin");
    expect(await screen.findByText("2 with Phone punching on")).toBeInTheDocument();
  });

  it("leaves the phone line out when nobody has phone punching on", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ count: 4, days: 14, phone_on_count: 0 }));
    renderRoute("/admin");
    await screen.findByText("On outside work: 3");
    expect(screen.queryByText(/with Phone punching on/)).not.toBeInTheDocument();
  });
});

describe("vercel.json (S-47)", () => {
  const config = JSON.parse(vercelText) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const value = (source: string, key: string) =>
    config.headers.find((rule) => rule.source === source)?.headers.find((h) => h.key === key)
      ?.value;

  it("puts the /phone rules after the catch-all rule", () => {
    const sources = config.headers.map((rule) => rule.source);
    const catchAll = sources.indexOf("/(.*)");
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(sources.indexOf("/phone")).toBeGreaterThan(catchAll);
    expect(sources.indexOf("/phone/:path*")).toBeGreaterThan(catchAll);
  });

  it("has a strict CSP and a camera, location and passkey Permissions-Policy for /phone", () => {
    for (const source of ["/phone", "/phone/:path*"]) {
      const csp = value(source, "Content-Security-Policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/);
      const policy = value(source, "Permissions-Policy") ?? "";
      expect(policy).toContain("camera=(self)");
      expect(policy).toContain("geolocation=(self)");
      expect(policy).toContain("publickey-credentials-get=(self)");
      expect(policy).toContain("microphone=()");
    }
  });

  // M6 (decision 0038 choice 2): the gate page /attendance now has its own strict CSP like /phone.
  // The admin pages still have none.
  it("keeps the admin pages without a Content-Security-Policy", () => {
    expect(value("/(.*)", "Permissions-Policy")).toBe(
      "camera=(self), geolocation=(self), microphone=()",
    );
    expect(
      config.headers.some((rule) =>
        rule.headers.some(
          (h) =>
            h.key === "Content-Security-Policy" &&
            !rule.source.startsWith("/phone") &&
            !rule.source.startsWith("/attendance"),
        ),
      ),
    ).toBe(false);
  });
});
