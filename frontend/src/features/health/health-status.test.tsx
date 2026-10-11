// The server status line on /admin: checking, connected and unreachable (spec AC-7).
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/admin server status (spec AC-7)", () => {
  it("says it is checking while the request is on its way", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    renderRoute("/admin");

    expect(screen.getByRole("status")).toHaveTextContent("Checking server…");
  });

  it("shows 'Server connected' and the server time in IST", async () => {
    const health = { status: "ok", version: "dev", server_time: "2026-10-12T00:30:00Z" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(health)),
    );

    renderRoute("/admin");

    expect(await screen.findByText("Server connected")).toBeInTheDocument();
    expect(screen.getByText("Server time: 12/10/2026, 06:00 IST")).toBeInTheDocument();
  });

  it("says the server is not reachable when the dev proxy answers 502", async () => {
    // In development the Vite proxy answers 502 (not a network error) when the backend is off.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );

    renderRoute("/admin");

    expect(
      await screen.findByText("Server not reachable. Is the backend running?"),
    ).toBeInTheDocument();
  });

  it("says the server is not reachable when the call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    renderRoute("/admin");

    expect(
      await screen.findByText("Server not reachable. Is the backend running?"),
    ).toBeInTheDocument();
  });
});
