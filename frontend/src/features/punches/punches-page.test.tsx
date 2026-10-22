// The punch log: what each role sees, the chips and filters, paging, the photo and compare
// dialogs (each shown photo is one request, so one audit entry), the export and the errors
// (spec M2 §4.10, §5.3; AC-23, AC-24, AC-33, AC-34, AC-37; design gate C).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "../../lib/format";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { punchItem, rejectedPunch, summary } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";

const IN = punchItem({ id: "pu-in" });
const OUT = punchItem({
  id: "pu-out",
  direction: "out",
  server_received_at: "2026-10-20T10:00:00Z",
  employee: { id: "e-2", code: "T-3050", name: "Ravi Shinde" },
});
const DARK = punchItem({
  id: "pu-dark",
  server_received_at: "2026-10-20T02:00:00Z",
  snapshot: { state: "stored", is_dark: true, expires_at: "2026-12-19T01:32:00Z", purged_at: null },
});
const REVOKED = rejectedPunch("QR_REVOKED");
const VISITOR = rejectedPunch("WRONG_PLANT", {
  employee: null,
  employee_hidden: true,
  snapshot: { state: "purged", is_dark: null, expires_at: null, purged_at: "2026-10-21T00:05:00Z" },
});
const UNKNOWN = rejectedPunch("QR_SIGNATURE_INVALID", {
  employee: null,
  snapshot: { state: "upload_failed", is_dark: null, expires_at: null, purged_at: null },
});
const COOLDOWN = rejectedPunch("COOLDOWN_ACTIVE", {
  snapshot: { state: "none", is_dark: null, expires_at: null, purged_at: null },
});

const ROWS = [OUT, VISITOR, UNKNOWN, COOLDOWN, REVOKED, DARK, IN];

type Calls = ReturnType<typeof mockApi>;

function answers(options: { me?: unknown; items?: unknown[]; summaryBody?: unknown } = {}) {
  const { me = SUPER_ADMIN, items = ROWS, summaryBody = summary() } = options;
  return {
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /kiosks": { body: [{ id: "k-1", name: "K134 main gate", plant_id: "p-1" }] },
    "GET /punches": { body: { items, page: 1, page_size: 50, total: items.length } },
    "GET /punches/summary": { body: summaryBody },
  };
}

function lastQuery(calls: Calls, path: string): URLSearchParams {
  const call = [...calls].reverse().find((entry) => entry.path.split("?")[0] === path);
  return new URLSearchParams(call?.path.split("?")[1] ?? "");
}

// The loading skeleton is also a table, so wait for a real row: one with a time like 07:02:00.
async function tableLoaded() {
  await waitFor(() => expect(screen.getAllByRole("row")[1]).toHaveTextContent(/\d\d:\d\d:\d\d/));
}

function snapshotCalls(calls: Calls) {
  return calls.filter((entry) => /\/snapshot$/.test(entry.path));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake-photo");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("punch log: the list", () => {
  it("shows the day's punches with who, direction, result, reason, kiosk and photo state", async () => {
    mockApi(answers());

    renderRoute("/admin/punches");

    await tableLoaded();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(ROWS.length + 1); // + the header
    const firstRow = within(rows[1] as HTMLElement);
    expect(firstRow.getByText("Ravi Shinde")).toBeInTheDocument();
    expect(firstRow.getByText("T-3050")).toBeInTheDocument();
    expect(firstRow.getByText("OUT")).toBeInTheDocument();
    expect(firstRow.getByText("Accepted")).toBeInTheDocument();
    expect(firstRow.getByText("K134 main gate")).toBeInTheDocument();
    expect(firstRow.getByText("Photo stored")).toBeInTheDocument();
    expect(firstRow.getByText("kept until 19/12/2026")).toBeInTheDocument();
    // The time is the server time in IST, with seconds.
    expect(screen.getByText("15:30:00")).toBeInTheDocument();
  });

  it("says in words what happened to each photo and who an unknown card is", async () => {
    mockApi(answers());

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(screen.getByText("Photo deleted on 21/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Photo not saved")).toBeInTheDocument();
    expect(screen.getByText("– No photo")).toBeInTheDocument();
    expect(screen.getByText("Unknown card")).toBeInTheDocument();
    expect(screen.getAllByText("Card blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("QR_REVOKED")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Already punched (scanned again too soon)")).toBeInTheDocument();
  });

  it("asks for today by default and shows the day's totals as chips", async () => {
    const calls = mockApi(answers());

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(lastQuery(calls, "/punches").get("date")).toBe(todayIst());
    expect(await screen.findByRole("button", { name: /286\s*Accepted IN/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /41\s*Accepted OUT/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /15\s*Rejected/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3\s*Dark photos/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3\s*Card of another plant/ })).toBeInTheDocument();
  });

  it("shows the empty state for a day without punches", async () => {
    mockApi(
      answers({
        items: [],
        summaryBody: summary({
          accepted_in: 0,
          accepted_out: 0,
          rejected: 0,
          dark_photos: 0,
          rejected_by_reason: {},
        }),
      }),
    );

    renderRoute("/admin/punches");

    expect(await screen.findByText("No punches yet today at this plant.")).toBeInTheDocument();
  });

  it("tells a failed load and lets the person try again", async () => {
    let attempts = 0;
    mockApi({
      ...answers(),
      "GET /punches": () => {
        attempts += 1;
        return attempts === 1
          ? apiError(500, "INTERNAL_ERROR")
          : { body: { items: [IN], page: 1, page_size: 50, total: 1 } };
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/punches");
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Asha Kale")).toBeInTheDocument();
  });
});

describe("punch log: the chips and filters", () => {
  it("shows only rejected punches when the Rejected chip is pressed, and all again on a second press", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    const chip = await screen.findByRole("button", { name: /15\s*Rejected/ });

    await user.click(chip);
    await waitFor(() => expect(lastQuery(calls, "/punches").get("decision")).toBe("rejected"));
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await user.click(chip);
    await waitFor(() => expect(lastQuery(calls, "/punches").get("decision")).toBeNull());
  });

  it("filters by the IN chip, the Dark photos chip and a rejection reason", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/punches");

    await user.click(await screen.findByRole("button", { name: /286\s*Accepted IN/ }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("decision")).toBe("accepted"));

    await user.click(screen.getByRole("button", { name: /3\s*Dark photos/ }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("dark_only")).toBe("true"));

    await user.click(screen.getByRole("button", { name: /3\s*Card of another plant/ }));
    await waitFor(() => {
      expect(lastQuery(calls, "/punches").get("reason_code")).toBe("WRONG_PLANT");
      expect(lastQuery(calls, "/punches").get("dark_only")).toBeNull();
    });
  });

  it("searches by code or name after a short wait, and filters by device", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();

    await user.type(screen.getByLabelText("Search by employee code or name"), "kale");
    await waitFor(() => expect(lastQuery(calls, "/punches").get("q")).toBe("kale"));

    await user.selectOptions(screen.getByLabelText("Device"), "K134 main gate");
    await waitFor(() => expect(lastQuery(calls, "/punches").get("kiosk_id")).toBe("k-1"));
  });

  it("goes to the previous day and back, never into the future", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("date")).not.toBe(todayIst()));
    expect(screen.queryByText("Live")).not.toBeInTheDocument(); // only today refreshes by itself

    await user.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("date")).toBe(todayIst()));
    expect(await screen.findByText("Live")).toBeInTheDocument();
  });

  it("sets a past date typed into the date box", async () => {
    const calls = mockApi(answers());
    renderRoute("/admin/punches");
    await tableLoaded();

    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "2026-10-01" } });

    await waitFor(() => expect(lastQuery(calls, "/punches").get("date")).toBe("2026-10-01"));
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });
});

describe("punch log: the roles", () => {
  it("gives the Super Admin View photo and Compare, and the dark mark", async () => {
    mockApi(answers());

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(screen.getAllByRole("button", { name: "View photo" })).toHaveLength(4); // stored photos
    expect(screen.getAllByRole("button", { name: "Compare" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dark photo").length).toBeGreaterThan(0);
  });

  it("gives a Plant Head text only: no photo buttons, no dark mark, own-plant note", async () => {
    mockApi(answers({ me: PLANT_HEAD, summaryBody: summary({ dark_photos: null }) }));

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(screen.queryByRole("button", { name: "View photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
    expect(screen.queryByText("Dark photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dark photos/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only, your plant only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export day (.xlsx)" })).toBeInTheDocument();
  });

  it("shows 'Card of another plant' without a name or code where the server hides the person", async () => {
    mockApi(
      answers({
        me: PLANT_HEAD,
        items: [VISITOR, IN],
        summaryBody: summary({ dark_photos: null }),
      }),
    );

    renderRoute("/admin/punches");
    await tableLoaded();

    const visitorRow = screen.getAllByRole("row")[1] as HTMLElement;
    // In the employee column and again as the reason.
    expect(within(visitorRow).getAllByText("Card of another plant")).toHaveLength(2);
    expect(within(visitorRow).queryByText(/T-\d+/)).not.toBeInTheDocument();
  });

  it("gives the Corporate Head a read-only page", async () => {
    mockApi(answers({ me: CORPORATE_HEAD, summaryBody: summary({ dark_photos: null }) }));

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(
      screen.getByText(/Read-only\. Only the Super Admin can open punch photos/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View photo" })).not.toBeInTheDocument();
  });

  it.each([
    ["Super Admin", SUPER_ADMIN],
    ["Corporate Head", CORPORATE_HEAD],
    ["Plant Head", PLANT_HEAD],
  ])("is in the menu for the %s", async (_role, me) => {
    mockApi(answers({ me }));

    renderRoute("/admin/punches");

    expect(await screen.findByRole("link", { name: "Punch log" })).toHaveAttribute(
      "href",
      "/admin/punches",
    );
  });
});

describe("punch log: the photo dialog", () => {
  it("opens the photo of a punch, says the view is recorded, and asks the server once", async () => {
    const calls = mockApi({ ...answers(), "GET /punches/pu-in/snapshot": { body: {} } });
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();
    // The last row (the oldest punch) is Asha Kale's IN.
    const lastRow = screen.getAllByRole("row").at(-1) as HTMLElement;

    await user.click(within(lastRow).getByRole("button", { name: "View photo" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("img")).toHaveAttribute("src", "blob:fake-photo");
    expect(within(dialog).getByText("Viewing is recorded in the audit log.")).toBeInTheDocument();
    expect(snapshotCalls(calls)).toHaveLength(1);
    expect(snapshotCalls(calls)[0]?.path).toContain("/punches/pu-in/snapshot");
  });

  it("steps to the older photo and back, each step a new request", async () => {
    const photos = Object.fromEntries(
      ["pu-out", "pu-QR_REVOKED", "pu-dark", "pu-in"].map((id) => [
        `GET /punches/${id}/snapshot`,
        { body: {} },
      ]),
    );
    const calls = mockApi({ ...answers(), ...photos });
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();

    await user.click(screen.getAllByRole("button", { name: "View photo" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("img");
    expect(within(dialog).getByRole("button", { name: "Newer" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Older" }));
    await waitFor(() => expect(snapshotCalls(calls)).toHaveLength(2));
    // The photos of the list, newest first: OUT, the rejected card, the dark one, the IN.
    expect(snapshotCalls(calls)[1]?.path).toContain("/punches/pu-QR_REVOKED/snapshot");

    await user.click(within(dialog).getByRole("button", { name: "Newer" }));
    await waitFor(() => expect(snapshotCalls(calls)).toHaveLength(3));
    expect(snapshotCalls(calls)[2]?.path).toContain("/punches/pu-out/snapshot");
  });

  it.each([
    ["SNAPSHOT_PURGED", 410, "This photo was deleted after the retention period."],
    ["SNAPSHOT_NOT_AVAILABLE", 404, "No photo is available for this punch."],
    ["STORAGE_UNAVAILABLE", 503, "The photo store cannot be reached. Try again later."],
  ])("explains %s in words", async (code, status, words) => {
    mockApi({ ...answers(), "GET /punches/pu-out/snapshot": apiError(status, code) });
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();

    await user.click(screen.getAllByRole("button", { name: "View photo" })[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(words)).toBeInTheDocument();
  });

  it("compares with the card's earlier photos: this punch beside up to three earlier ones", async () => {
    const earlier = [
      punchItem({
        id: "pu-e1",
        server_received_at: "2026-10-19T13:32:00Z",
        kiosk: { id: "k-2", name: "TP1 gate" },
      }),
      punchItem({ id: "pu-e2", server_received_at: "2026-10-18T01:32:00Z" }),
    ];
    const calls = mockApi({
      ...answers(),
      "GET /punches/pu-out/compare": { body: { current: OUT, earlier } },
      "GET /punches/pu-out/snapshot": { body: {} },
      "GET /punches/pu-e1/snapshot": { body: {} },
      "GET /punches/pu-e2/snapshot": { body: {} },
    });
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();

    await user.click(screen.getAllByRole("button", { name: "Compare" })[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Earlier punches of this card (2)")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByRole("img")).toHaveLength(3));
    expect(within(dialog).getByText("TP1 gate")).toBeInTheDocument();
    expect(
      within(dialog).getByText("3 photos shown. Each photo shown is recorded in the audit log."),
    ).toBeInTheDocument();
    expect(snapshotCalls(calls)).toHaveLength(3);
  });

  it("says so when the card has no earlier photos", async () => {
    mockApi({
      ...answers(),
      "GET /punches/pu-out/compare": { body: { current: OUT, earlier: [] } },
      "GET /punches/pu-out/snapshot": { body: {} },
    });
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await tableLoaded();

    await user.click(screen.getAllByRole("button", { name: "Compare" })[0] as HTMLElement);

    expect(await screen.findByText("This card has no earlier stored photos.")).toBeInTheDocument();
  });
});

describe("punch log: the export", () => {
  it("downloads the day with the same filters and no paging", async () => {
    const calls = mockApi({ ...answers(), "GET /punches/export.xlsx": { body: {} } });
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    const user = userEvent.setup();
    renderRoute("/admin/punches");
    await user.click(await screen.findByRole("button", { name: /286\s*Accepted IN/ }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("decision")).toBe("accepted"));

    await user.click(screen.getByRole("button", { name: "Export day (.xlsx)" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const query = lastQuery(calls, "/punches/export.xlsx");
    expect(query.get("date")).toBe(todayIst());
    expect(query.get("decision")).toBe("accepted");
    expect(query.has("page")).toBe(false);
    expect(query.has("page_size")).toBe(false);
  });

  it("tells when the day is too large to export", async () => {
    mockApi({
      ...answers(),
      "GET /punches/export.xlsx": apiError(422, "EXPORT_TOO_LARGE"),
    });
    const user = userEvent.setup();
    renderRoute("/admin/punches");

    await user.click(await screen.findByRole("button", { name: "Export day (.xlsx)" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
