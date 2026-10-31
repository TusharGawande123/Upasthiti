// Plants pages: the list, the empty state, the readiness card and the read-only view for a
// Plant Head. The map itself (Leaflet) is replaced by a stub because jsdom cannot draw maps.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

vi.mock("./geofence-map", () => ({ GeofenceMap: () => <div data-testid="map-stub" /> }));

const PLANT_HEAD = { ...SUPER_ADMIN, id: "u-3", role: "plant_head", plant_ids: ["p-1"] };

const K134 = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "K-134, MIDC Waluj",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  active_kiosks: 1,
  active_employees: 142,
};
const PC1 = {
  ...K134,
  id: "p-2",
  code: "PC1",
  name: "Precise Cuts, Unit 1",
  geofence_set: false,
  active_kiosks: 0,
};

const READINESS = {
  plant_id: "p-1",
  geofence: true,
  active_shifts: 2,
  active_categories: 4,
  active_kiosks: 0,
  active_employees: 0,
  ready: false,
};

function page(items: unknown[]) {
  return { body: { items, page: 1, page_size: 200, total: items.length } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plants list", () => {
  it("shows plants with an icon+word geofence status and summary numbers", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /plants": page([K134, PC1]) });

    renderRoute("/admin/plants");

    const row = (await screen.findByText("Sheet Shapers (K-134)")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Set")).toBeInTheDocument();
    expect(within(row).getByText("142")).toBeInTheDocument();
    const pcRow = screen.getByText("Precise Cuts, Unit 1").closest("tr") as HTMLElement;
    expect(within(pcRow).getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("filters by the typed text", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /plants": page([K134, PC1]) });
    const user = userEvent.setup();

    renderRoute("/admin/plants");
    await user.type(await screen.findByPlaceholderText("Search code or name"), "pc1");

    expect(screen.queryByText("Sheet Shapers (K-134)")).not.toBeInTheDocument();
    expect(screen.getByText("Precise Cuts, Unit 1")).toBeInTheDocument();
  });

  it("offers the client's 7 plants when there are none, and sends the request", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": page([]),
      "POST /setup/client-plants": { body: { created: 7, skipped: 0 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants");
    await user.click(await screen.findByRole("button", { name: "Add Sheet Shapers' 7 plants" }));

    expect(
      calls.some((call) => call.method === "POST" && call.path === "/setup/client-plants"),
    ).toBe(true);
  });

  it("hides the add buttons from a Plant Head", async () => {
    mockApi({ "GET /auth/me": { body: PLANT_HEAD }, "GET /plants": page([K134]) });

    renderRoute("/admin/plants");

    await screen.findByText("Sheet Shapers (K-134)");
    expect(screen.queryByRole("button", { name: "Add a plant" })).not.toBeInTheDocument();
  });

  it("shows the error with a retry button when loading fails", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": apiError(500, "INTERNAL_ERROR"),
    });

    renderRoute("/admin/plants");

    expect(await screen.findByText(/went wrong on the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("plant detail", () => {
  const answers = (me: unknown) => ({
    "GET /auth/me": { body: me },
    "GET /plants/p-1": { body: K134 },
    "GET /plants/p-1/readiness": { body: READINESS },
  });

  it("shows the readiness card: done, missing and none-yet in words", async () => {
    mockApi(answers(SUPER_ADMIN));

    renderRoute("/admin/plants/p-1");

    expect(await screen.findByText("Ready for attendance?")).toBeInTheDocument();
    expect(screen.getByText("Not ready · 2 left")).toBeInTheDocument();
    expect(
      screen.getByText("No active attendance device. Pair a phone, tablet or PC at the gate."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Done").length).toBe(3);
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });

  it("lets the Super Admin edit but gives a Plant Head a read-only view", async () => {
    mockApi(answers(PLANT_HEAD));

    renderRoute("/admin/plants/p-1");

    expect(await screen.findByText(/Only the Super Admin changes plant setup/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  it("shows the shifts with the live sentence for a night shift in the dialog", async () => {
    mockApi({
      ...answers(SUPER_ADMIN),
      "GET /plants/p-1/shifts": {
        body: [
          {
            id: "s-1",
            plant_id: "p-1",
            name: "General",
            start_time: "07:00:00",
            end_time: "19:00:00",
            crosses_midnight: false,
            grace_min: 30,
            half_day_min: 240,
            overtime_min_minutes: 120,
            is_active: true,
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));
    expect(await screen.findByText("07:00 – 19:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add shift" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Shift name"), "Night");
    fireTime(within(dialog).getByLabelText("Shift starts"), "19:00");
    fireTime(within(dialog).getByLabelText("Shift ends"), "07:00");

    // M5: grace only after the start, the shift length is the full day, overtime from the shift end.
    expect(
      await within(dialog).findByText(
        "On time until 19:30. Arriving up to 19:30 counts from 19:00.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Full day: 12 h. Arrive by 19:30 and stay until 07:00."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Overtime from 07:00, only when you stay 2 h or more after the shift end.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/This shift ends the next morning/)).toBeInTheDocument();
  });

  it("refuses a shift whose start and end time are the same", async () => {
    mockApi({ ...answers(SUPER_ADMIN), "GET /plants/p-1/shifts": { body: [] } });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));
    await user.click(await screen.findByRole("button", { name: "Add shift" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Shift name"), "Odd");
    fireTime(within(dialog).getByLabelText("Shift starts"), "07:00");
    fireTime(within(dialog).getByLabelText("Shift ends"), "07:00");

    expect(
      await within(dialog).findByText("Start and end time cannot be the same."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save rules" })).toBeDisabled();
  });

  it("opens the geofence tab with the map and the version list", async () => {
    mockApi({
      ...answers(SUPER_ADMIN),
      "GET /plants/p-1/geofence/versions": {
        body: [
          {
            id: "g-1",
            version: 1,
            shape: "circle",
            geojson: { type: "Point", coordinates: [75.2, 19.85] },
            radius_m: "150",
            buffer_m: 25,
            is_current: true,
            created_at: "2026-10-12T05:00:00Z",
            created_by: null,
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Geofence" }));

    expect(await screen.findByTestId("map-stub")).toBeInTheDocument();
    expect(screen.getByText("Circle · 150 m radius")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new version" })).toBeDisabled();
  });
});

// <input type="time"> has no typing helper in user-event; set the value like the browser does.
import { fireEvent } from "@testing-library/react";

function fireTime(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}
