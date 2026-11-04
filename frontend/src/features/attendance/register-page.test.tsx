// The monthly register (/admin/attendance/register, spec M5 §4.4): grid with code and colour,
// month totals, legend, the one-plant rule, downloads, states and role differences.
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

const MONTH = todayIst().slice(0, 7);

const TOTALS = {
  present: 1,
  half_day: 1,
  short_hours: 0,
  absent: 1,
  incomplete: 0,
  leave_paid: 2,
  leave_unpaid: 0,
  weekly_off: 4,
  holiday: 0,
  worked_on_off_day: 0,
  worked_min: 1440,
  overtime_min: 90,
  late_count: 1,
  late_min: 45,
  early_exit_count: 0,
};

function row(index: number) {
  const cell = (day: number, code: string, corrected = false) => ({
    date: `${MONTH}-0${day}`,
    code,
    is_corrected: corrected,
    has_exceptions: false,
  });
  return {
    employee: {
      id: `e-${index}`,
      code: `E${1000 + index}`,
      name: `Person ${index}`,
      type: "permanent",
      department: null,
      category: null,
      contractor: null,
    },
    days: [cell(1, "P"), cell(2, "HD", true), cell(3, "A"), cell(4, "–")],
    totals: TOTALS,
  };
}

function register(items: unknown[]) {
  return {
    body: {
      month: MONTH,
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
      days_in_month: 4,
      items,
      page: 1,
      page_size: 100,
      total: items.length,
    },
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /attendance/register": register([row(1), row(2)]),
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the monthly register", () => {
  it("shows every day as a code on its colour, with a dot for a corrected day", async () => {
    const calls = mockApi(base());

    renderRoute("/admin/attendance/register");

    const grid = (await screen.findAllByRole("table"))[0] as HTMLElement;
    const present = within(grid).getAllByRole("button", { name: /Person 1, day 1, P/ })[0];
    expect(present).toHaveTextContent("P");
    expect(present?.className).toContain("text-[#04694b]");
    const halfDay = within(grid).getAllByRole("button", {
      name: /Person 1, day 2, HD, corrected/,
    })[0];
    expect(halfDay?.className).toContain("text-[#8f5300]");
    expect(halfDay?.querySelector("span.bg-black")).not.toBeNull();
    expect(within(grid).getAllByLabelText("none").length).toBeGreaterThan(0);
    // The plant defaults to the first plant, because the register needs exactly one.
    expect(lastQuery(calls, "/attendance/register").get("plant_id")).toBe("p-1");
    expect(lastQuery(calls, "/attendance/register").get("month")).toBe(MONTH);
  });

  it("shows the month totals and the legend", async () => {
    mockApi(base());

    renderRoute("/admin/attendance/register");

    const grid = (await screen.findAllByRole("table"))[0] as HTMLElement;
    for (const heading of ["Present days", "Half-days", "Leave paid / unpaid", "Late count"]) {
      expect(within(grid).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(within(grid).getAllByText("2 / 0").length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("24 h").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Legend" })).toBeInTheDocument();
    expect(screen.getByText("Worked on a weekly off")).toBeInTheDocument();
    expect(screen.getByText("A black dot means the day was corrected.")).toBeInTheDocument();
  });

  it("opens the day drawer address from a cell", async () => {
    mockApi(base());
    const user = userEvent.setup();

    const router = renderRoute("/admin/attendance/register");
    const grid = (await screen.findAllByRole("table"))[0] as HTMLElement;
    await user.click(
      within(grid).getAllByRole("button", { name: /Person 2, day 3, A/ })[0] as HTMLElement,
    );

    expect(router.state.location.search).toContain(`day=e-2%3A${MONTH}-03`);
  });

  it("asks the server for the plant, the month and the type that are chosen", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await screen.findAllByRole("table");
    await user.selectOptions(screen.getByRole("combobox", { name: "Plant" }), "p-2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "temporary");

    await waitFor(() =>
      expect(lastQuery(calls, "/attendance/register").get("type")).toBe("temporary"),
    );
    expect(lastQuery(calls, "/attendance/register").get("plant_id")).toBe("p-2");
  });

  it("downloads Excel and PDF from the report endpoint for the plant and month", async () => {
    mockApi(base());
    const jsonFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/reports/register.")
        ? new Response("file", { status: 200 })
        : jsonFetch(url, init),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:register");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await screen.findAllByRole("table");
    await user.click(screen.getByRole("button", { name: "Download Excel" }));
    await user.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/reports/register.xlsx?month=${MONTH}&plant_id=p-1`,
        expect.anything(),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/reports/register.pdf?month=${MONTH}&plant_id=p-1`,
        expect.anything(),
      );
    });
  });

  it("shows the server's text when the PDF is too big", async () => {
    mockApi(base());
    const jsonFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.includes("/reports/register.pdf")
          ? Response.json(
              { error: { code: "REPORT_TOO_LARGE", message: "x", details: {} } },
              { status: 422 },
            )
          : jsonFetch(url, init),
      ),
    );
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await screen.findAllByRole("table");
    await user.click(screen.getByRole("button", { name: "Download PDF" }));

    expect(await screen.findByText(/more than 3,000 rows/)).toBeInTheDocument();
  });

  it("shows the empty and error states", async () => {
    mockApi(base({ "GET /attendance/register": register([]) }));
    renderRoute("/admin/attendance/register");
    expect(await screen.findByText("No employees for this plant and month")).toBeInTheDocument();
  });

  it("shows the error state with a way to try again", async () => {
    mockApi(base({ "GET /attendance/register": apiError(500, "INTERNAL_ERROR") }));
    renderRoute("/admin/attendance/register");
    expect(await screen.findByText("The list could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("opens a month card for one person on the phone list", async () => {
    mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await screen.findAllByRole("table");
    await user.click(screen.getByRole("button", { name: /Person 2/, expanded: false }));

    expect(screen.getAllByText("Worked hours").length).toBeGreaterThan(1);
  });

  it("fixes a Plant Head to their own plant", async () => {
    const calls = mockApi(base({ "GET /auth/me": { body: PLANT_HEAD } }));

    renderRoute("/admin/attendance/register");

    await screen.findAllByRole("table");
    expect(lastQuery(calls, "/attendance/register").get("plant_id")).toBe("p-1");
    expect(screen.queryByRole("combobox", { name: "Plant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("lets a Corporate Head pick any plant, read only", async () => {
    mockApi(base({ "GET /auth/me": { body: CORPORATE_HEAD } }));

    renderRoute("/admin/attendance/register");

    await screen.findAllByRole("table");
    expect(screen.getByRole("combobox", { name: "Plant" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("the register of a date range (M5c)", () => {
  const RANGE_DAYS = [
    { date: "2026-11-01", weekday: 7 },
    { date: "2026-11-02", weekday: 1 },
  ];
  const rangeAnswer = (pending = 0) => ({
    body: {
      date_from: "2026-11-01",
      date_to: "2026-11-02",
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
      days: RANGE_DAYS,
      items: [
        {
          ...row(1),
          days: [
            { date: "2026-11-01", code: "P", is_corrected: false, has_exceptions: false },
            { date: "2026-11-02", code: "A", is_corrected: false, has_exceptions: false },
          ],
        },
      ],
      page: 1,
      page_size: 100,
      total: 1,
      preparing: { pending_days: pending },
    },
  });

  it("switches to a range, fills the dates from a ready-made period and asks the server", async () => {
    const calls = mockApi(base({ "GET /attendance/register-range": rangeAnswer() }));
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await user.click(await screen.findByRole("button", { name: "Date range" }));
    await user.click(screen.getByRole("button", { name: "Last month" }));

    await waitFor(() => {
      const query = lastQuery(calls, "/attendance/register-range");
      expect(query.get("date_from")).toMatch(/^\d{4}-\d{2}-01$/);
      expect(query.get("plant_id")).toBe("p-1");
    });
    const grid = (await screen.findAllByRole("table"))[0] as HTMLElement;
    expect(within(grid).getByText("01/11")).toBeInTheDocument();
    expect(within(grid).getByText("02/11")).toBeInTheDocument();
  });

  it("says the days are being prepared while the server is still calculating", async () => {
    mockApi(base({ "GET /attendance/register-range": rangeAnswer(120) }));
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await user.click(await screen.findByRole("button", { name: "Date range" }));

    expect(await screen.findByText("Getting the days ready")).toBeInTheDocument();
    expect(screen.getByText(/120 days are still being calculated/)).toBeInTheDocument();
  });

  it("keeps a range longer than 93 days off the screen but still allows the file", async () => {
    mockApi(base({ "GET /attendance/register-range": rangeAnswer() }));
    const user = userEvent.setup();

    renderRoute("/admin/attendance/register");
    await user.click(await screen.findByRole("button", { name: "Date range" }));
    const from = screen.getByLabelText("From");
    await user.clear(from);
    await user.type(from, "2026-01-01");
    const to = screen.getByLabelText("To");
    await user.clear(to);
    await user.type(to, "2026-06-30");

    expect(await screen.findByText(/shows at most 93 days/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download Excel/ })).toBeEnabled();
  });
});
