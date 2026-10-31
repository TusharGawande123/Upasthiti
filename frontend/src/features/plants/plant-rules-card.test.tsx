// Weekly off and attendance start date on the plant page (design gate C screen 3): history with
// In force / Upcoming / Earlier, the change dialogs, their warnings and errors, and the read-only
// view of the other roles.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

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
  attendance_start_date: "2026-10-01",
};

const SUNDAY = { weekday: 7, effective_from: "2026-04-01", created_at: "2026-03-30T00:00:00Z" };
const SATURDAY_OLD = {
  weekday: 6,
  effective_from: "2025-10-01",
  created_at: "2025-09-30T00:00:00Z",
};
const SATURDAY_NEXT = {
  weekday: 6,
  effective_from: "2099-11-15",
  created_at: "2026-10-30T00:00:00Z",
};

function answers(extra: Record<string, unknown> = {}, me: unknown = SUPER_ADMIN) {
  return {
    "GET /auth/me": { body: me },
    "GET /plants/p-1": { body: PLANT },
    "GET /plants/p-1/readiness": { body: { plant_id: "p-1", ready: true } },
    "GET /plants/p-1/weekly-off": {
      body: { current: SUNDAY, history: [SUNDAY, SATURDAY_OLD] },
    },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

afterEach(() => vi.unstubAllGlobals());

describe("weekly off", () => {
  it("shows the weekday in force and the history", async () => {
    mockApi(answers());

    renderRoute("/admin/plants/p-1");

    expect(await screen.findByText("from 01/04/2026")).toBeInTheDocument();
    expect(screen.getByText("From 01/10/2025")).toBeInTheDocument();
    expect(screen.getByText("In force")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026")).toBeInTheDocument();
  });

  it("shows an upcoming change", async () => {
    mockApi(
      answers({
        "GET /plants/p-1/weekly-off": {
          body: { current: SUNDAY, history: [SUNDAY, SATURDAY_NEXT] },
        },
      }),
    );

    renderRoute("/admin/plants/p-1");

    expect(
      await screen.findByText(
        "Changes to Saturday from 15/11/2099. Until then Sunday stays the weekly off.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("changes the weekly off from a date and warns what becomes a working day", async () => {
    const calls = mockApi(
      answers({
        "POST /plants/p-1/weekly-off": { status: 201, body: { weekly_off: SATURDAY_NEXT } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Change weekly off" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("radio", { name: "Saturday" }));
    fireEvent.change(dialog.getByLabelText("Applies from"), { target: { value: "2099-11-15" } });

    expect(
      dialog.getByText(
        "From 15/11/2099 Saturday is the weekly off and Sunday becomes a working day at K134.",
      ),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Save weekly off" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      weekday: 6,
      effective_from: "2099-11-15",
    });
  });

  it("refuses a date in the past", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Change weekly off" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Applies from"), { target: { value: "2020-01-01" } });

    expect(
      dialog.getByText("The date must be today or later. A past weekly off cannot be changed."),
    ).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save weekly off" })).toBeDisabled();
  });

  it("is read-only for a Corporate Head", async () => {
    mockApi(answers({}, CORPORATE_HEAD));

    renderRoute("/admin/plants/p-1");

    await screen.findByText("from 01/04/2026");
    expect(screen.queryByRole("button", { name: "Change weekly off" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change start date" })).not.toBeInTheDocument();
  });

  it("shows an error when the weekly off cannot be loaded", async () => {
    mockApi(answers({ "GET /plants/p-1/weekly-off": apiError(500, "INTERNAL") }));

    renderRoute("/admin/plants/p-1");

    expect(await screen.findByText("Weekly off")).toBeInTheDocument();
    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
  });
});

describe("attendance start date", () => {
  it("warns which days are hidden when the date moves later, then saves", async () => {
    const calls = mockApi(answers({ "PATCH /plants/p-1": { body: PLANT } }));
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Change start date" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Start date"), { target: { value: "2026-10-15" } });

    expect(
      dialog.getByText(/Moving the date later hides 01\/10\/2026 to 14\/10\/2026/),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Save start date" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      attendance_start_date: "2026-10-15",
    });
  });

  it("shows the server's message when the date cannot move earlier", async () => {
    mockApi(answers({ "PATCH /plants/p-1": apiError(409, "ATTENDANCE_START_INVALID") }));
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("button", { name: "Change start date" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Start date"), { target: { value: "2026-09-01" } });
    await user.click(dialog.getByRole("button", { name: "Save start date" }));

    expect(await dialog.findByText(/the start date can only move later/)).toBeInTheDocument();
  });
});
