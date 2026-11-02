// The attendance list (/admin/attendance, spec M5 §4.3): rows, status chips and marks, the filters,
// the dashboard's `?show=` tile mapping, the days-to-decide banner, states, roles, opening a day
// and the daily muster download.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "@/lib/format";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import {
  CORPORATE_HEAD,
  PLANT_HEAD,
  PLANT_K134,
  PLANT_X280,
  page,
} from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { lastQuery } from "../../test/review-fixtures";

function dayOf(changes: Record<string, unknown> = {}) {
  return {
    date: todayIst(),
    plant: { id: "p-1", code: "K134" },
    shift: { id: "s-1", name: "General" },
    employee_type: "permanent",
    day_kind: "working",
    status: "present",
    code: "P",
    open_state: null,
    first_in: "2026-10-29T03:30:00Z",
    last_out: "2026-10-29T11:30:00Z",
    worked_min: 480,
    payable_min: 480,
    status_min: 480,
    shift_length_min: 480,
    extra_punch_count: 0,
    late_min: 0,
    early_exit_min: 0,
    overtime_min: 0,
    exceptions: [],
    is_corrected: false,
    pending_corrections: 0,
    uses_unchecked_flag: false,
    ...changes,
  };
}

function item(
  index: number,
  day: Record<string, unknown> = {},
  changes: Record<string, unknown> = {},
) {
  return {
    employee: {
      id: `e-${index}`,
      code: `E${1000 + index}`,
      name: `Person ${index}`,
      type: "permanent",
      department: "Assembly",
      category: "Worker",
      contractor: null,
      ...changes,
    },
    day: dayOf(day),
  };
}

const ROWS = [
  item(1),
  item(2, { status: "half_day", code: "HD", late_min: 45, status_min: 440, is_corrected: true }),
  item(3, { status: "absent", code: "A", first_in: null, last_out: null, worked_min: 0 }),
  item(4, {
    status: "open",
    code: "IN",
    open_state: "inside",
    last_out: null,
    exceptions: ["OUT_MISSING"],
    pending_corrections: 1,
  }),
];

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /contractors": { body: [] },
    "GET /attendance/undecided": { body: { short_hours: 0, incomplete: 0, plants: [] } },
    "GET /attendance/daily": page(ROWS),
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the attendance list", () => {
  it("shows one row per person with status chip, times, late and marks", async () => {
    const calls = mockApi(base());

    renderRoute("/admin/attendance");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Person 1")).toBeInTheDocument();
    expect(within(table).getAllByText("Present").length).toBeGreaterThan(0);
    expect(within(table).getByText("Half-day")).toBeInTheDocument();
    expect(within(table).getByText("HD")).toBeInTheDocument();
    expect(within(table).getByText("7 h 20 m of 8 h")).toBeInTheDocument();
    expect(within(table).getByText("45 m")).toBeInTheDocument();
    expect(within(table).getByText("In progress")).toBeInTheDocument();
    expect(within(table).getByText(/Inside since/)).toBeInTheDocument();
    expect(within(table).getByText("Correction pending")).toBeInTheDocument();
    expect(within(table).getByText("IN is there but the OUT is missing.")).toBeInTheDocument();
    expect(screen.getByText("Showing 4 of 4 people")).toBeInTheDocument();
    expect(lastQuery(calls, "/attendance/daily").get("date")).toBe(todayIst());
  });

  it("sends the filters the user picks", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/attendance");
    await screen.findByRole("table");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "short_hours");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "temporary");
    await user.click(screen.getByRole("button", { name: "Has exceptions" }));
    await user.type(screen.getByRole("searchbox", { name: "Code or name" }), "ram");

    await waitFor(() => expect(lastQuery(calls, "/attendance/daily").get("q")).toBe("ram"));
    const query = lastQuery(calls, "/attendance/daily");
    expect(query.get("status")).toBe("short_hours");
    expect(query.get("type")).toBe("temporary");
    expect(query.get("has_exceptions")).toBe("true");
  });

  it.each([
    ["on_leave", "status", "leave"],
    ["exceptions", "has_exceptions", "true"],
    ["to_decide", "status", "short_hours"],
    ["not_arrived", "status", "open"],
    ["inside", "status", "open"],
    ["off_today", "status", "weekly_off"],
  ])("maps the dashboard tile %s to %s=%s", async (show, param, value) => {
    const calls = mockApi(base());

    renderRoute(`/admin/attendance?show=${show}&plant_id=p-1`);

    await screen.findByRole("table");
    const query = lastQuery(calls, "/attendance/daily");
    expect(query.get(param)).toBe(value);
    expect(query.get("plant_id")).toBe("p-1");
    expect(screen.getByText(/From the dashboard/)).toBeInTheDocument();
  });

  it("shows the whole day, and says it is the closest list, for a tile with no exact filter", async () => {
    const calls = mockApi(base());

    renderRoute("/admin/attendance?show=late");

    await screen.findByRole("table");
    expect(lastQuery(calls, "/attendance/daily").get("status")).toBeNull();
    expect(screen.getByText(/closest list/)).toBeInTheDocument();
  });

  it("offers the days to decide and filters to them", async () => {
    const calls = mockApi(
      base({
        "GET /attendance/undecided": { body: { short_hours: 9, incomplete: 3, plants: [] } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/attendance");
    expect(await screen.findByText("12 days to decide")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show them" }));

    await waitFor(() =>
      expect(lastQuery(calls, "/attendance/daily").get("status")).toBe("short_hours"),
    );
  });

  it("opens the day drawer address when a row is opened", async () => {
    mockApi(base());
    const user = userEvent.setup();

    const router = renderRoute("/admin/attendance");
    await screen.findByRole("table");
    await user.click(
      screen.getAllByRole("button", { name: "Open day: Person 2" })[0] as HTMLElement,
    );

    expect(router.state.location.search).toContain(`day=e-2%3A${todayIst()}`);
  });

  it("moves to the previous day", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/attendance");
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Previous day" }));

    await waitFor(() =>
      expect(lastQuery(calls, "/attendance/daily").get("date")).not.toBe(todayIst()),
    );
  });

  it("shows the empty state and clears the filters", async () => {
    mockApi(base({ "GET /attendance/daily": page([]) }));

    renderRoute("/admin/attendance?show=on_leave");

    expect(await screen.findByText("No attendance for these filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("shows the error state with a way to try again", async () => {
    mockApi(base({ "GET /attendance/daily": apiError(500, "INTERNAL_ERROR") }));

    renderRoute("/admin/attendance");

    expect(await screen.findByText("The list could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the loading skeleton while the server answers", async () => {
    mockApi(base({ "GET /attendance/daily": { hang: true } }));

    renderRoute("/admin/attendance");

    await screen.findByRole("heading", { name: "Attendance" });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("downloads the daily muster as a PDF for the chosen plant", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base());
    const jsonFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/reports/daily-muster.pdf")
        ? new Response("%PDF-1.7", { status: 200 })
        : jsonFetch(url, init),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:muster");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderRoute("/admin/attendance");
    await user.click(await screen.findByRole("button", { name: /Download daily muster · PDF/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/reports/daily-muster.pdf?date=${todayIst()}&plant_id=p-1`,
        expect.anything(),
      ),
    );
  });

  it("shows the server's text when the muster cannot be made", async () => {
    mockApi(base());
    const jsonFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.includes("/reports/daily-muster.xlsx")
          ? Response.json(
              { error: { code: "REPORT_BUSY", message: "x", details: {} } },
              { status: 429 },
            )
          : jsonFetch(url, init),
      ),
    );
    const user = userEvent.setup();

    renderRoute("/admin/attendance");
    await user.click(await screen.findByRole("button", { name: /Download daily muster · Excel/ }));

    expect(await screen.findByText(/still being built/)).toBeInTheDocument();
  });

  it("gives a Plant Head their own plant without a plant picker", async () => {
    const calls = mockApi(base({ "GET /auth/me": { body: PLANT_HEAD } }));

    renderRoute("/admin/attendance");

    await screen.findByRole("table");
    expect(lastQuery(calls, "/attendance/daily").get("plant_id")).toBe("p-1");
    expect(screen.queryByRole("combobox", { name: "Plant filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("lets a Corporate Head read every plant with no demo switch", async () => {
    const calls = mockApi(base({ "GET /auth/me": { body: CORPORATE_HEAD } }));

    renderRoute("/admin/attendance");

    await screen.findByRole("table");
    expect(lastQuery(calls, "/attendance/daily").get("plant_id")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Plant filter" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
