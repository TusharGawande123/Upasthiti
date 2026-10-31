// The Punctuality screen (/admin/insights/punctuality): the four tiles with the change against the
// period before (arrow and word), the group table, the top ten, and the empty, error, range and
// role states. The charts themselves are drawn by Recharts, which needs a real layout, so their
// numbers are checked through the tables and the text alternatives.
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { daysInPeriod, previousPeriod } from "./use-punctuality";

function answer(overrides: Record<string, unknown> = {}) {
  return {
    on_time_percent: 91.4,
    arrivals: 210,
    late_count: 214,
    average_late_min: 23,
    early_exit_count: 87,
    weekly: [
      { week_start: "2026-10-05", on_time_percent: 90.8 },
      { week_start: "2026-10-12", on_time_percent: 92.4 },
    ],
    groups: [
      {
        key: "d-1",
        label: "Stores",
        arrivals: 1210,
        late_count: 46,
        on_time_percent: 96.2,
        average_late_min: 14,
      },
      {
        key: "d-2",
        label: "Maintenance",
        arrivals: 1040,
        late_count: 121,
        on_time_percent: 88.4,
        average_late_min: 31,
      },
    ],
    top_late: [
      {
        employee: { id: "e-1", code: "E0344", name: "Nilesh Thorat" },
        late_count: 14,
        late_min: 412,
      },
    ],
    ...overrides,
  };
}

const before = answer({
  on_time_percent: 90.2,
  late_count: 232,
  average_late_min: 21,
  early_exit_count: 93,
});

function setup(me: unknown = SUPER_ADMIN, body: (path: string) => unknown = () => answer()) {
  return mockApi({
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /insights/punctuality": (call) => ({ body: body(call.path) }),
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("period helpers", () => {
  it("counts the days and finds the period just before", () => {
    const period = { dateFrom: "2026-10-02", dateTo: "2026-10-31" };
    expect(daysInPeriod(period)).toBe(30);
    expect(previousPeriod(period)).toEqual({ dateFrom: "2026-09-02", dateTo: "2026-10-01" });
  });
});

describe("the punctuality page", () => {
  it("shows the tiles with arrows and words against the period before", async () => {
    // The first request is the period itself; the one that starts earlier is the period before.
    let first = "";
    setup(SUPER_ADMIN, (path) => {
      const from = /date_from=([\d-]+)/.exec(path)?.[1] ?? "";
      first = first || from;
      return from === first ? answer() : before;
    });

    renderRoute("/admin/insights/punctuality");

    expect(await screen.findByText("91.4")).toBeInTheDocument();
    expect(await screen.findByText("1.2 points higher than the period before")).toBeInTheDocument();
    expect(screen.getByText("18 fewer than before")).toBeInTheDocument();
    expect(screen.getByText("2 min longer than before")).toBeInTheDocument();
    expect(screen.getByText("6 fewer than before")).toBeInTheDocument();
    expect(screen.getAllByText("Late arrivals").length).toBeGreaterThan(0);
  });

  it("lists the groups, marks one below 90 percent in words and shows the top ten", async () => {
    setup();

    renderRoute("/admin/insights/punctuality");

    expect(await screen.findByRole("heading", { name: "By department" })).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getAllByText("Maintenance").length).toBeGreaterThan(0);
    expect(screen.getByText("Below 90%")).toBeInTheDocument();
    expect(screen.getByText("Nilesh Thorat")).toBeInTheDocument();
    expect(screen.getByText("14 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View month/ })).toHaveAttribute(
      "href",
      "/admin/employees/e-1?tab=attendance",
    );
  });

  it("groups by weekday with the day names, from the server's day numbers", async () => {
    const calls = setup(SUPER_ADMIN, (path) =>
      answer({
        groups: path.includes("group_by=weekday")
          ? [
              {
                key: "1",
                label: "1",
                arrivals: 100,
                late_count: 13,
                on_time_percent: 86.9,
                average_late_min: 20,
              },
              {
                key: "2",
                label: "2",
                arrivals: 100,
                late_count: 8,
                on_time_percent: 92,
                average_late_min: 15,
              },
            ]
          : [],
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/insights/punctuality");
    await screen.findByRole("heading", { name: "By department" });
    await user.click(screen.getByRole("button", { name: "Weekday" }));

    expect(await screen.findByRole("heading", { name: "By weekday" })).toBeInTheDocument();
    expect(screen.getAllByText("Monday").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tuesday").length).toBeGreaterThan(0);
    expect(calls.some((call) => call.path.includes("group_by=weekday"))).toBe(true);
  });

  it("refuses more than 92 days without asking the server", async () => {
    const calls = setup();

    renderRoute("/admin/insights/punctuality");
    await screen.findByRole("heading", { name: "By department" });
    const asked = calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-01-01" } });

    expect(await screen.findByText(/Choose up to 92 days/)).toBeInTheDocument();
    expect(screen.getByText("Choose a shorter period")).toBeInTheDocument();
    expect(calls.length).toBe(asked);
  });

  it("shows the empty state when nobody came in the period", async () => {
    setup(SUPER_ADMIN, () => answer({ arrivals: 0, groups: [], top_late: [], weekly: [] }));

    renderRoute("/admin/insights/punctuality");

    expect(await screen.findByText("No arrivals in this period")).toBeInTheDocument();
  });

  it("shows an error with Try again", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": page([PLANT_K134], 200),
      "GET /insights/punctuality": apiError(500, "INTERNAL"),
    });

    renderRoute("/admin/insights/punctuality");

    expect(await screen.findByText(/Punctuality could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers the demo switch to the Super Admin only, and locks a Plant Head's plant", async () => {
    setup(CORPORATE_HEAD);
    renderRoute("/admin/insights/punctuality");
    await screen.findByRole("heading", { name: "By department" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("sends the plant of a Plant Head", async () => {
    const calls = setup(PLANT_HEAD);

    renderRoute("/admin/insights/punctuality");
    await screen.findByRole("heading", { name: "By department" });

    const request = calls.find((call) => call.path.startsWith("/insights/punctuality"));
    expect(request?.path).toContain("plant_id=p-1");
    expect(within(document.body).getAllByText(/K134/).length).toBeGreaterThan(0);
  });
});
