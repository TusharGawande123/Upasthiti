// The server status line on the dashboard: checking, connected and unreachable (spec AC-7).
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard server status (spec AC-7)", () => {
  it("says it is checking while the request is on its way", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /health": { hang: true } });

    renderRoute("/admin");

    expect(await screen.findByText("Checking server…")).toBeInTheDocument();
  });

  it("shows 'Server connected' and the server time in IST", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /health": {
        body: { status: "ok", version: "dev", server_time: "2026-10-12T00:30:00Z" },
      },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Server connected")).toBeInTheDocument();
    expect(screen.getByText("Server time: 12/10/2026, 06:00 IST")).toBeInTheDocument();
  });

  it("says the server is not reachable when the dev proxy answers 502", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /health": { status: 502, body: "" },
    });

    renderRoute("/admin");

    expect(await screen.findByText(/Server not reachable/)).toBeInTheDocument();
  });
});
