// "My sessions" screen: the list, the current device badge, logging out another device, errors.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SESSIONS = [
  {
    id: "s-1",
    created_at: "2026-10-29T03:00:00Z",
    last_seen_at: "2026-10-29T04:00:00Z",
    ip: "10.0.0.5",
    browser: "Chrome on Windows",
    is_current: true,
  },
  {
    id: "s-2",
    created_at: "2026-10-28T03:00:00Z",
    last_seen_at: "2026-10-28T04:00:00Z",
    ip: null,
    browser: null,
    is_current: false,
  },
];

describe("my sessions", () => {
  it("lists the devices and logs out another one", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /auth/sessions": { body: SESSIONS },
      "DELETE /auth/sessions/s-2": { status: 204 },
    });
    renderRoute("/admin/sessions");

    expect(await screen.findByText("Chrome on Windows")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Unknown browser")).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.5/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "DELETE" && call.path === "/auth/sessions/s-2"),
      ).toBe(true),
    );
  });

  it("shows the error when the list cannot be loaded", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /auth/sessions": apiError(500, "SERVER_ERROR"),
    });
    renderRoute("/admin/sessions");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
