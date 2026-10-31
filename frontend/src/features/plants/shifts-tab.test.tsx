// The Shifts tab of a plant: switching a shift off and on with a reason, a refused switch, the
// empty and error states, an upcoming rule line, and the read-only view of a Plant Head.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_HEAD } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

afterEach(() => vi.unstubAllGlobals());

const PLANT = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  active_kiosks: 1,
  active_employees: 0,
};

function shift(changes: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    plant_id: "p-1",
    name: "Night",
    start_time: "19:00:00",
    end_time: "07:00:00",
    crosses_midnight: true,
    shift_length_min: 720,
    grace_min: 15,
    half_day_min: 360,
    overtime_min_minutes: 60,
    is_active: true,
    rules_from: "2026-10-01",
    upcoming_rules: null,
    ...changes,
  };
}

function answers(shifts: unknown, extra: Record<string, unknown> = {}, me: unknown = SUPER_ADMIN) {
  return {
    "GET /auth/me": { body: me },
    "GET /plants/p-1": { body: PLANT },
    "GET /plants/p-1/readiness": { body: { plant_id: "p-1", ready: true } },
    "GET /plants/p-1/weekly-off": { body: { current: null, history: [] } },
    "GET /plants/p-1/shifts": shifts,
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

async function openTab() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Shifts" }));
  return user;
}

function rowOf() {
  return screen.getByText(/Night/).closest("li") as HTMLElement;
}

describe("shifts tab", () => {
  it("switches a shift off with a reason, then closes the dialog", async () => {
    const calls = mockApi(
      answers(
        { body: [shift({ upcoming_rules: { effective_from: "2026-11-01" } })] },
        { "POST /shifts/s-1/deactivate": { body: shift({ is_active: false }) } },
      ),
    );
    renderRoute("/admin/plants/p-1");
    const user = await openTab();
    expect(await screen.findByText(/Night/)).toBeInTheDocument();

    await user.click(within(rowOf()).getByRole("button", { name: "Switch off" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason"), "No night work");
    await user.click(dialog.getByRole("button", { name: "Switch off" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/shifts/s-1/deactivate")?.body).toEqual({
        reason: "No night work",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches an off shift back on", async () => {
    const calls = mockApi(
      answers(
        { body: [shift({ is_active: false })] },
        { "POST /shifts/s-1/reactivate": { body: shift() } },
      ),
    );
    renderRoute("/admin/plants/p-1");
    const user = await openTab();
    await user.click(await screen.findByRole("button", { name: "Switch on" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason"), "Night work again");
    await user.click(dialog.getByRole("button", { name: "Switch on" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/shifts/s-1/reactivate")).toBe(true),
    );
  });

  it("shows the server's refusal and clears it when the dialog is cancelled", async () => {
    mockApi(
      answers(
        { body: [shift()] },
        { "POST /shifts/s-1/deactivate": apiError(409, "LAST_ACTIVE_SHIFT") },
      ),
    );
    renderRoute("/admin/plants/p-1");
    const user = await openTab();
    await screen.findByText(/Night/);
    await user.click(within(rowOf()).getByRole("button", { name: "Switch off" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason"), "Test");
    await user.click(dialog.getByRole("button", { name: "Switch off" }));
    expect(await dialog.findByRole("alert")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the add form and shows the empty text when there are no shifts", async () => {
    mockApi(answers({ body: [] }));
    renderRoute("/admin/plants/p-1");
    const user = await openTab();
    expect(await screen.findByText("No shifts yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add shift" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows an error when the shifts cannot be loaded", async () => {
    mockApi(answers(apiError(500, "SERVER_ERROR")));
    renderRoute("/admin/plants/p-1");
    await openTab();
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });

  it("is read-only for a Plant Head", async () => {
    mockApi(answers({ body: [shift()] }, {}, PLANT_HEAD));
    renderRoute("/admin/plants/p-1");
    await openTab();
    expect(await screen.findByText(/Night/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch off" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit rules" })).toBeNull();
  });
});
