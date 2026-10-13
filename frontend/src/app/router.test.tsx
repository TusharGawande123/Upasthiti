// Which page each address shows, and who may see it (spec AC-8, AC-3).
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../test/mock-api";
import { renderRoute } from "../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it("sends a visitor who is not logged in from / to the login screen", async () => {
    mockApi({ "GET /auth/me": apiError(401, "NOT_AUTHENTICATED") });

    const router = renderRoute("/");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/login");
  });

  it("shows the dashboard to a logged-in user", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /health": {
        body: { status: "ok", version: "dev", server_time: "2026-10-12T00:30:00Z" },
      },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Welcome, Tushar Gawande")).toBeInTheDocument();
    expect(await screen.findByText("Server connected")).toBeInTheDocument();
  });

  it("keeps a user with a temporary password on the new-password screen", async () => {
    mockApi({ "GET /auth/me": { body: { ...SUPER_ADMIN, must_change_password: true } } });

    const router = renderRoute("/admin/users");

    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/new-password");
  });

  it("shows the kiosk placeholder at /kiosk without a login", () => {
    renderRoute("/kiosk");

    expect(screen.getByRole("heading", { name: "Upasthiti Kiosk" })).toBeInTheDocument();
  });

  it("shows 'Page not found' with a way back for unknown addresses", () => {
    renderRoute("/no-such-page");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the admin dashboard" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });
});
