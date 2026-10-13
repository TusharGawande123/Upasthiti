// Setup wizard: five steps with done / not done in words, and the plants that still need a geofence.
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const STEPS_HALF_DONE = {
  steps: [
    { key: "plants", done: true },
    { key: "geofence", done: false },
    { key: "shifts_and_categories", done: true },
    { key: "kiosk", done: false },
    { key: "employees", done: false },
  ],
};

const PC1 = {
  id: "p-2",
  name: "Precise Cuts, Unit 1",
  code: "PC1",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: false,
  active_kiosks: 0,
  active_employees: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setup wizard", () => {
  it("shows progress and lists the plants that have no geofence", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /setup/status": { body: STEPS_HALF_DONE },
      "GET /plants": { body: { items: [PC1], page: 1, page_size: 200, total: 1 } },
    });

    renderRoute("/admin/setup");

    expect(await screen.findByText("2 of 5 steps done")).toBeInTheDocument();
    const geofenceStep = screen
      .getByText(/Draw each plant's geofence/)
      .closest("li") as HTMLElement;
    expect(within(geofenceStep).getByText("PC1")).toBeInTheDocument();
    expect(within(geofenceStep).getByRole("link", { name: "Draw geofence" })).toHaveAttribute(
      "href",
      "/admin/plants/p-2",
    );
  });

  it("says everything is done when all steps are done", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /setup/status": {
        body: { steps: STEPS_HALF_DONE.steps.map((step) => ({ ...step, done: true })) },
      },
      "GET /plants": { body: { items: [], page: 1, page_size: 200, total: 0 } },
    });

    renderRoute("/admin/setup");

    expect(await screen.findByText(/All steps are done/)).toBeInTheDocument();
  });
});
