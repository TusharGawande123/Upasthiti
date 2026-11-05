// One employee over a period (M5c): the day-by-day list with totals, the type column after a
// conversion, the progress note, and the Excel and print-sheet files.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { employee, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { lastQuery } from "../../test/review-fixtures";

const TOTALS = {
  present: 2,
  half_day: 0,
  short_hours: 0,
  absent: 1,
  incomplete: 0,
  leave_paid: 0,
  leave_unpaid: 0,
  weekly_off: 1,
  holiday: 0,
  worked_on_off_day: 0,
  worked_min: 960,
  overtime_min: 0,
  late_count: 1,
  late_min: 20,
  early_exit_count: 0,
};

function day(date: string, changes: Record<string, unknown> = {}) {
  return {
    date,
    plant: { id: "p-1", code: "K134" },
    shift: { id: "s-1", name: "Office" },
    employee_type: "temporary",
    day_kind: "working",
    status: "present",
    code: "P",
    open_state: null,
    first_in: "2026-10-27T03:35:00Z",
    last_out: "2026-10-27T11:30:00Z",
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

function rangeAnswer(extra: Record<string, unknown> = {}) {
  return {
    body: {
      employee: {
        id: "e-1",
        code: "1001",
        name: "Ramesh Kulkarni",
        type: "permanent",
        department: null,
        category: null,
        contractor: null,
      },
      date_from: "2026-10-27",
      date_to: "2026-10-29",
      days: [
        day("2026-10-27"),
        day("2026-10-28", { late_min: 20 }),
        day("2026-10-29", { employee_type: "permanent" }),
      ],
      totals: TOTALS,
      totals_by_type: {
        temporary: { ...TOTALS, present: 2, worked_min: 960 },
        permanent: { ...TOTALS, present: 1, worked_min: 480 },
      },
      type_changes: [
        { from_date: "2026-10-27", type: "temporary" },
        { from_date: "2026-10-29", type: "permanent" },
      ],
      preparing: { pending_days: 0 },
      ...extra,
    },
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /contractors": { body: [] },
    "GET /employees/e-1": {
      body: { employee: employee(), plant_history: [], shift_history: [] },
    },
    "GET /employees/e-1/timeline": { body: [] },
    "GET /employees/e-1/qr-cards": { body: { cards: [] } },
    "GET /plants/p-1/shifts": { body: [] },
    "GET /plants/p-1/categories": { body: [] },
    "GET /plants/p-1/departments": { body: [] },
    "GET /attendance/employee/e-1": {
      body: { employee: {}, days: [], totals: TOTALS, leave: [], corrections: [] },
    },
    "GET /attendance/employee/e-1/year": { body: { months: [] } },
    "GET /employees/e-1/shift-swaps": { body: [] },
    "GET /attendance/employee/e-1/range": rangeAnswer(),
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

// The tab is loaded on demand (lazy): the first test waits for that load, also on a busy machine.
const SLOW = { timeout: 12_000 };

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("one employee over a period", () => {
  it("lists every day with its totals and shows the type only when it changed", async () => {
    const calls = mockApi(base());

    renderRoute("/admin/employees/e-1?tab=attendance");

    await screen.findByText("Day by day for a period", {}, SLOW);
    const table = (await screen.findAllByRole("table")).find((item) =>
      within(item).queryByText("Early exit"),
    ) as HTMLElement;
    expect(within(table).getByText("27/10/2026")).toBeInTheDocument();
    expect(within(table).getAllByText("Temporary").length).toBeGreaterThan(0);
    expect(within(table).getByText("Permanent")).toBeInTheDocument();
    expect(within(table).getByText("20 min")).toBeInTheDocument();
    expect(screen.getByText(/Temporary: 2 present/)).toBeInTheDocument();
    expect(lastQuery(calls, "/attendance/employee/e-1/range").get("date_to")).toBeTruthy();
  });

  it("fills the dates from a ready-made period", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1?tab=attendance");
    await screen.findByText("Day by day for a period", {}, SLOW);
    await user.click(screen.getAllByRole("button", { name: "Last 7 days" })[0] as HTMLElement);

    await waitFor(() => {
      const query = lastQuery(calls, "/attendance/employee/e-1/range");
      expect(query.get("date_from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("says the days are being prepared", async () => {
    mockApi(
      base({
        "GET /attendance/employee/e-1/range": rangeAnswer({ preparing: { pending_days: 40 } }),
      }),
    );

    renderRoute("/admin/employees/e-1?tab=attendance");

    expect(await screen.findByText("Getting the days ready")).toBeInTheDocument();
    expect(screen.getByText(/40 days are still being calculated/)).toBeInTheDocument();
  });

  it("downloads the Excel file and the print sheet for the chosen dates", async () => {
    mockApi(base());
    const jsonFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/reports/employee-range.")
        ? new Response("file", { status: 200 })
        : jsonFetch(url, init),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:range");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1?tab=attendance");
    await screen.findByText("Day by day for a period", {}, SLOW);
    const buttons = await screen.findAllByRole("button", { name: "Download Excel" });
    await user.click(buttons[buttons.length - 1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Print sheet (PDF)" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(
        urls.some((url) => /\/reports\/employee-range\.xlsx\?.*employee_id=e-1/.test(url)),
      ).toBe(true);
      expect(
        urls.some((url) => /\/reports\/employee-range\.pdf\?.*employee_id=e-1/.test(url)),
      ).toBe(true);
    });
  });
});

describe("overtime is for temporary workers only (M5c)", () => {
  it("shows no overtime figure in the totals of a permanent employee", async () => {
    const permanentDays = [day("2026-10-27", { employee_type: "permanent" })];
    mockApi(
      base({
        "GET /attendance/employee/e-1/range": rangeAnswer({
          days: permanentDays,
          totals_by_type: { permanent: TOTALS },
          type_changes: [{ from_date: "2026-10-27", type: "permanent" }],
        }),
      }),
    );

    renderRoute("/admin/employees/e-1?tab=attendance");

    await screen.findByText("Day by day for a period", {}, SLOW);
    const cards = await screen.findAllByText("Overtime hours");
    // The month totals above the heatmap and the period totals both show a dash, never a time.
    for (const label of cards) {
      expect(label.nextSibling).toHaveTextContent("–");
    }
  });

  it("still shows the overtime of a temporary worker", async () => {
    mockApi(
      base({
        "GET /attendance/employee/e-1/range": rangeAnswer({
          totals: { ...TOTALS, overtime_min: 150 },
        }),
      }),
    );

    renderRoute("/admin/employees/e-1?tab=attendance");

    await screen.findByText("Day by day for a period", {}, SLOW);
    const labels = await screen.findAllByText("Overtime hours");
    expect(labels.some((label) => label.nextSibling?.textContent === "2 h 30 m")).toBe(true);
  });
});
