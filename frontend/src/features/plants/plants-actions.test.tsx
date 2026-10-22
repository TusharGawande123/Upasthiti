// Plant changes by the Super Admin: add/edit/switch off a plant, departments and categories,
// shifts, and saving a drawn geofence. Each change sends the right request.
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import type { Draft } from "./geofence-geometry";

// A stand-in for the Leaflet map: two buttons "draw" a good and a tiny polygon.
vi.mock("./geofence-map", () => ({
  GeofenceMap: ({ onDraftChange }: { onDraftChange?: (draft: Draft | null) => void }) => {
    const square = (size: number): Draft => ({
      shape: "polygon",
      geojson: {
        type: "Polygon",
        coordinates: [
          [
            [75.2, 19.85],
            [75.2 + size, 19.85],
            [75.2 + size, 19.85 + size],
            [75.2, 19.85 + size],
            [75.2, 19.85],
          ],
        ],
      },
    });
    return (
      <div>
        <button type="button" onClick={() => onDraftChange?.(square(0.0009))}>
          draw good
        </button>
        <button type="button" onClick={() => onDraftChange?.(square(0.00005))}>
          draw tiny
        </button>
      </div>
    );
  },
}));

const PLANT = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "K-134, MIDC Waluj",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: false,
  active_kiosks: 0,
  active_employees: 0,
};
const READINESS = {
  plant_id: "p-1",
  geofence: false,
  active_shifts: 1,
  active_categories: 1,
  active_kiosks: 0,
  active_employees: 0,
  ready: false,
};
const STAFF = { id: "c-1", plant_id: "p-1", name: "Staff", is_active: true };

const base = {
  "GET /auth/me": { body: SUPER_ADMIN },
  "GET /plants/p-1": { body: PLANT },
  "GET /plants/p-1/readiness": { body: READINESS },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function body(
  calls: { method: string; path: string; body: unknown }[],
  method: string,
  path: string,
) {
  return calls.find((call) => call.method === method && call.path === path)?.body;
}

describe("plant details", () => {
  it("adds a plant with the code in capitals and opens it", async () => {
    const created = { ...PLANT, id: "p-9", code: "NEW1", name: "New Plant" };
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": { body: { items: [PLANT], page: 1, page_size: 200, total: 1 } },
      "POST /plants": { status: 201, body: created },
      "GET /plants/p-9": { body: created },
      "GET /plants/p-9/readiness": { body: { ...READINESS, plant_id: "p-9" } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants");
    await user.click(await screen.findByRole("button", { name: "Add a plant" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Code"), "new1");
    await user.type(within(dialog).getByLabelText("Name"), "New Plant");
    await user.click(within(dialog).getByRole("button", { name: "Add a plant" }));

    // The plant page is the biggest lazily loaded page (the map library). On a busy machine
    // under coverage its first load can take longer than the usual wait.
    expect(
      await screen.findByRole("heading", { name: "New Plant" }, { timeout: 20_000 }),
    ).toBeInTheDocument();
    expect(body(calls, "POST", "/plants")).toMatchObject({ code: "NEW1", name: "New Plant" });
  });

  it("checks the code before sending", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": { body: { items: [PLANT], page: 1, page_size: 200, total: 1 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants");
    await user.click(await screen.findByRole("button", { name: "Add a plant" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Code"), "a");
    await user.type(within(dialog).getByLabelText("Name"), "X");
    await user.click(within(dialog).getByRole("button", { name: "Add a plant" }));

    expect(
      await within(dialog).findByText("Use 2–10 capital letters or digits."),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("edits name and address", async () => {
    const calls = mockApi({ ...base, "PATCH /plants/p-1": { body: PLANT } });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(body(calls, "PATCH", "/plants/p-1")).toMatchObject({ name: "Renamed" }),
    );
  });

  it("switches a plant off with a reason and shows the server's refusal", async () => {
    const calls = mockApi({
      ...base,
      "POST /plants/p-1/deactivate": apiError(409, "PLANT_HAS_ACTIVE_KIOSKS"),
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Switch off" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Plant closed");
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }));

    expect(
      await within(dialog).findByText(/Revoke the plant's active kiosks first/),
    ).toBeInTheDocument();
    expect(body(calls, "POST", "/plants/p-1/deactivate")).toEqual({ reason: "Plant closed" });
  });
});

describe("departments and categories", () => {
  it("adds a department", async () => {
    const calls = mockApi({
      ...base,
      "GET /plants/p-1/departments": { body: [] },
      "POST /plants/p-1/departments": { status: 201, body: { ...STAFF, name: "Stores" } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Departments" }));
    expect(await screen.findByText("No departments yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add department" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Stores");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(body(calls, "POST", "/plants/p-1/departments")).toEqual({ name: "Stores" }),
    );
  });

  it("renames a category and switches it off with a reason", async () => {
    const calls = mockApi({
      ...base,
      "GET /plants/p-1/categories": { body: [STAFF] },
      "PATCH /categories/c-1": { body: { ...STAFF, name: "Office staff" } },
      "POST /categories/c-1/deactivate": { body: { ...STAFF, is_active: false } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Categories" }));
    await user.click(await screen.findByRole("button", { name: "Edit Staff" }));
    let dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Office staff");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(body(calls, "PATCH", "/categories/c-1")).toEqual({ name: "Office staff" }),
    );

    // The plant's own "Switch off" is in the header; the category's is the last one.
    await screen.findByText("Staff");
    await user.click(screen.getAllByRole("button", { name: "Switch off" }).at(-1) as HTMLElement);
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Not used");
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }));
    await vi.waitFor(() =>
      expect(body(calls, "POST", "/categories/c-1/deactivate")).toEqual({ reason: "Not used" }),
    );
  });
});

describe("shifts", () => {
  it("saves a night shift with the times and limits", async () => {
    const calls = mockApi({
      ...base,
      "GET /plants/p-1/shifts": { body: [] },
      "POST /plants/p-1/shifts": { status: 201, body: {} },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));
    await user.click(await screen.findByRole("button", { name: "Add shift" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Shift name"), "Night");
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "19:00" } });
    fireEvent.change(within(dialog).getByLabelText("Ends"), { target: { value: "07:00" } });
    await user.click(within(dialog).getByRole("button", { name: "Save shift" }));

    await vi.waitFor(() =>
      expect(body(calls, "POST", "/plants/p-1/shifts")).toEqual({
        name: "Night",
        start_time: "19:00",
        end_time: "07:00",
        grace_min: 10,
        half_day_min: 240,
        ot_after_min: 480,
      }),
    );
  });
});

describe("geofence", () => {
  const answers = {
    ...base,
    "GET /plants/p-1/geofence/versions": { body: [] },
  };

  it("saves a drawn polygon with the margin as a new version", async () => {
    const calls = mockApi({
      ...answers,
      "PUT /plants/p-1/geofence": { body: { id: "g-1", version: 1 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Geofence" }));
    expect(await screen.findByText(/No geofence yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new version" })).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: "draw good" }));
    await user.type(screen.getByLabelText(/Reason/), "First survey");
    await user.click(screen.getByRole("button", { name: "Save new version" }));

    await vi.waitFor(() =>
      expect(body(calls, "PUT", "/plants/p-1/geofence")).toMatchObject({
        shape: "polygon",
        buffer_m: 25,
        reason: "First survey",
      }),
    );
  });

  it("does not allow saving a tiny shape and says why", async () => {
    mockApi(answers);
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Geofence" }));
    await user.click(await screen.findByRole("button", { name: "draw tiny" }));

    expect(await screen.findByText(/The shape is too small/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new version" })).toBeDisabled();
  });

  it("refuses a margin above 200 m", async () => {
    mockApi(answers);
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Geofence" }));
    await user.click(await screen.findByRole("button", { name: "draw good" }));
    const margin = screen.getByLabelText("Margin");
    await user.clear(margin);
    await user.type(margin, "500");

    expect(await screen.findByText("Use 0–200 metres.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save new version" })).toBeDisabled();
  });
});
