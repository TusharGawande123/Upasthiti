// The live dashboard and the emergency muster (spec M5 §4.1, §4.2): tiles, links, the stale line,
// the all-plants table, the demo switch, the Plant Head view, muster search, paging, PDF and print.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_HEAD, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { lastQuery } from "../../test/review-fixtures";

const NUMBERS = {
  inside_now: 214,
  inside_temporary: 98,
  expected: 236,
  arrived: 221,
  late: 12,
  not_arrived: 9,
  on_leave: 8,
  off_today: 14,
  exceptions: 11,
  undecided: { short_hours: 3, incomplete: 2 },
};
const K134 = { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)", is_demo: false };
const DEMO = { id: "p-9", code: "DEMO", name: "Demo plant", is_demo: true };

function plantLive(plant = K134, changes: Record<string, unknown> = {}) {
  return {
    ...NUMBERS,
    plant,
    attendance_started: true,
    by_contractor: [
      { contractor: { id: "c-1", name: "Shree Manpower" }, inside: 34 },
      { contractor: null, inside: 7 },
    ],
    shifts: [
      {
        shift: { id: "s-1", name: "General", start_time: "07:00", end_time: "19:00" },
        expected: 230,
        arrived: 221,
        late: 12,
      },
      {
        shift: { id: "s-2", name: "Night", start_time: "19:00", end_time: "07:00" },
        expected: 6,
        arrived: 0,
        late: 0,
      },
    ],
    ...changes,
  };
}

function live(plants: unknown[], totals = NUMBERS) {
  return { generated_at: "2026-10-28T03:32:00Z", date: "2026-10-28", plants, totals };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the live dashboard", () => {
  it("shows the tiles with their numbers and links for one plant", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    const calls = mockApi(base({ "GET /dashboard/live": { body: live([plantLive()]) } }));

    renderRoute("/admin");

    const late = await screen.findByRole("link", { name: "Late, 12. Open the list." });
    expect(late).toHaveAttribute("href", "/admin/attendance?show=late&plant_id=p-1");
    expect(
      screen.getByRole("link", { name: "Inside now, 214. Open the list." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Arrived, 221. Open the list." })).toHaveTextContent(
      "94% of expected",
    );
    expect(screen.getByRole("link", { name: /Days to decide, 5/ })).toHaveTextContent(
      "3 Short hours",
    );
    expect(screen.getByText("Of which temporary: 98")).toBeInTheDocument();
    expect(screen.getByText("Permanent: 116")).toBeInTheDocument();
    expect(screen.getByText("Shree Manpower")).toBeInTheDocument();
    expect(screen.getByText("No contractor")).toBeInTheDocument();
    expect(screen.getByText("Shift not started")).toBeInTheDocument();
    expect(screen.getByText("Devices, checks and set-up")).toBeInTheDocument();
    expect(lastQuery(calls, "/dashboard/live").get("plant_id")).toBe("p-1");
  });

  it("keeps the last numbers and says so when a refresh fails", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    let calls = 0;
    mockApi(
      base({
        "GET /dashboard/live": () => {
          calls += 1;
          return calls === 1 ? { body: live([plantLive()]) } : apiError(503, "UNKNOWN");
        },
      }),
    );

    renderRoute("/admin");
    await screen.findByRole("link", { name: "Late, 12. Open the list." });
    // Coming back to the tab fetches at once, like the 30 second timer does.
    window.dispatchEvent(new Event("visibilitychange"));

    const line = (await screen.findByText(/Could not refresh at/)).closest("[role=alert]");
    expect(line).not.toBeNull();
    expect(
      within(line as HTMLElement).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Late, 12. Open the list." })).toBeInTheDocument();
  });

  it("lists all plants with a total row and hides demo plants until the switch is on", async () => {
    const calls = mockApi(
      base({
        "GET /dashboard/live": (call: RecordedCall) =>
          call.path.includes("include_demo=true")
            ? { body: live([plantLive(), plantLive(DEMO)]) }
            : { body: live([plantLive()]) },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin");

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("row", { name: /Total.*214/ })).toBeInTheDocument();
    expect(within(table).queryByText("DEMO")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Show demo plants" }));

    expect(await within(await screen.findByRole("table")).findByText("DEMO")).toBeInTheDocument();
    expect(screen.getByText("Demo plants shown")).toBeInTheDocument();
    expect(lastQuery(calls, "/dashboard/live").get("include_demo")).toBe("true");
    expect(localStorage.getItem("upasthiti.showDemoPlants")).toBe("1");
  });

  it("shows a plant that has not started with a link to set the start date", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(
      base({
        "GET /dashboard/live": {
          body: live([plantLive(K134, { attendance_started: false, expected: 0 })]),
        },
      }),
    );

    renderRoute("/admin");

    expect(await screen.findByText("Not started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set the start date" })).toHaveAttribute(
      "href",
      "/admin/plants/p-1",
    );
  });

  it("gives a Plant Head no picker and no demo switch", async () => {
    mockApi(
      base({
        "GET /auth/me": { body: PLANT_HEAD },
        "GET /dashboard/live": { body: live([plantLive()]) },
      }),
    );

    renderRoute("/admin");

    await screen.findByRole("link", { name: "Late, 12. Open the list." });
    expect(screen.queryByRole("combobox", { name: "Plant filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getAllByText(/K134/).length).toBeGreaterThan(0);
  });
});

function person(index: number, changes: Record<string, unknown> = {}) {
  return {
    employee: {
      id: `e-${index}`,
      code: `E${1000 + index}`,
      name: `Person ${String(index).padStart(3, "0")}`,
      type: "permanent",
      category: "Worker",
      department: "Assembly",
      contractor: null,
      ...changes,
    },
    in_time: "2026-10-28T01:30:00Z",
    kiosk: { id: "k-1", name: "Main gate" },
  };
}

function muster(people: unknown[]) {
  return {
    generated_at: "2026-10-28T03:32:15Z",
    plants: [{ plant: K134, count: people.length, people }],
  };
}

describe("the emergency muster", () => {
  it("lists people with the count, pages them and searches", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    const people = Array.from({ length: 120 }, (_, index) =>
      person(index, index === 7 ? { contractor: "Shree Manpower", type: "temporary" } : {}),
    );
    mockApi(base({ "GET /muster": { body: muster(people) } }));
    const user = userEvent.setup();

    renderRoute("/admin/muster");

    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText("people inside")).toBeInTheDocument();
    expect(screen.getByText("List of 09:02:15")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 50 of 120 people. Print and PDF include everyone."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(
      screen.getByText("Showing 100 of 120 people. Print and PDF include everyone."),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "shree");
    expect(await screen.findByText('1 of 120 people match "shree"')).toBeInTheDocument();
  });

  it("downloads the PDF from the server for the chosen plant", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ "GET /muster": { body: muster([person(1)]) } }));
    const jsonFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/muster.pdf")
        ? new Response("%PDF-1.7", { status: 200 })
        : jsonFetch(url, init),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:muster");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderRoute("/admin/muster");
    await user.click(await screen.findByRole("button", { name: "Download PDF" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/muster.pdf?plant_id=p-1", expect.anything()),
    );
  });

  it("prints with the browser", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ "GET /muster": { body: muster([person(1)]) } }));
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = userEvent.setup();

    renderRoute("/admin/muster");
    await user.click(await screen.findByRole("button", { name: "Print" }));

    expect(print).toHaveBeenCalled();
  });

  it("keeps the saved list and turns the PDF off when there is no connection", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    let calls = 0;
    mockApi(
      base({
        "GET /muster": () => {
          calls += 1;
          return calls === 1 ? { body: muster([person(1)]) } : apiError(503, "UNKNOWN");
        },
      }),
    );

    renderRoute("/admin/muster");
    await screen.findByText("List of 09:02:15");
    window.dispatchEvent(new Event("visibilitychange"));

    expect(
      await screen.findByText(/No connection. This is the list of 09:02:15/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(screen.getByText("Download PDF needs a connection. Print works.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("says nobody is inside when the list is empty", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-1");
    mockApi(base({ "GET /muster": { body: muster([]) } }));

    renderRoute("/admin/muster");

    expect(await screen.findByText("Nobody is inside right now")).toBeInTheDocument();
  });

  it("folds each plant into its own block for All plants, and is in the menu", async () => {
    mockApi(
      base({
        "GET /muster": {
          body: {
            generated_at: "2026-10-28T03:32:15Z",
            plants: [
              { plant: K134, count: 1, people: [person(1)] },
              { plant: { ...K134, id: "p-2", code: "X280" }, count: 1, people: [person(2)] },
            ],
          },
        },
      }),
    );

    renderRoute("/admin/muster");

    await screen.findAllByText(/K134 · Sheet Shapers/);
    expect(document.querySelectorAll("summary")).toHaveLength(2);
    const menu = screen.getByRole("navigation", { name: "Main menu" });
    expect(within(menu).getByRole("link", { name: /Emergency muster/ })).toBeInTheDocument();
  });
});
