// The dashboard card "Cards ending soon" and the matching badge in the menu: Super Admin only.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /health": { body: { status: "ok", version: "dev", server_time: "2026-10-20T10:00:00Z" } },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("cards ending soon", () => {
  it("shows the Super Admin how many cards end soon, with a link to exactly those", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 12, days: 14 } },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Cards ending soon")).toBeInTheDocument();
    expect(
      await screen.findByText("12 QR cards end in the next 14 days. Extend them or let them end."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See these cards" })).toHaveAttribute(
      "href",
      "/admin/qr-cards?state=expiring",
    );
  });

  it("speaks of one card in the singular", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 1, days: 14 } },
    });

    renderRoute("/admin");

    expect(
      await screen.findByText("1 QR card ends in the next 14 days. Extend it or let it end."),
    ).toBeInTheDocument();
  });

  it("puts the number in the menu next to QR cards for the Super Admin", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 12, days: 14 } },
    });

    renderRoute("/admin");

    const link = await screen.findByRole("link", { name: /QR cards/ });
    expect(await within(link).findByText("12")).toBeInTheDocument();
    expect(within(link).getByText("cards end soon")).toBeInTheDocument();
  });

  it("shows no badge when no card ends soon", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 0, days: 14 } },
    });

    renderRoute("/admin");

    const link = await screen.findByRole("link", { name: /QR cards/ });
    await screen.findByText("Cards ending soon");
    expect(within(link).queryByText("0")).not.toBeInTheDocument();
  });

  it.each([
    ["Corporate Head", CORPORATE_HEAD],
    ["Plant Head", PLANT_HEAD],
  ])(
    "shows a %s neither the card nor the badge, and never asks for the number",
    async (_name, me) => {
      const calls = mockApi({ ...LAYOUT, "GET /auth/me": { body: me } });

      renderRoute("/admin");

      await screen.findByRole("link", { name: "QR cards" });
      expect(screen.queryByText("Cards ending soon")).not.toBeInTheDocument();
      expect(calls.some((call) => call.path.includes("expiring-count"))).toBe(false);
    },
  );
});
