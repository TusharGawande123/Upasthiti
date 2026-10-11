import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../test/render";

beforeEach(() => {
  // /admin asks for the server status; these tests only check which page shows.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

describe("routes (spec AC-8)", () => {
  it("sends / to the admin page", async () => {
    const router = renderRoute("/");

    expect(await screen.findByText("Admin dashboard – coming in M1")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin");
  });

  it("shows the kiosk placeholder at /kiosk", () => {
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
