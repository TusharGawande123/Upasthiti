// Gate notices: the list for each role, the form with its live kiosk preview and checks, saving,
// "End now" and the server's refusals (spec M2 §4.11, §5.4; AC-31; design gate C).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { istDateAndTime } from "../../lib/dates";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { formProblem, oneLine } from "./notice-form-dialog";
import type { Notice } from "./use-notices";

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: "n-1",
    plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
    text: "Gate 2 is closed for repair until 14:00.",
    level: "important",
    // A real notice lasts at most 90 days, so the form accepts these dates as they are.
    starts_at: "2099-12-20T04:30:00Z",
    ends_at: "2099-12-31T18:29:00Z",
    state: "showing",
    created_by: { id: "u-1", name: "Tushar Gawande" },
    created_at: "2026-10-20T04:00:00Z",
    ended_at: null,
    ended_by: null,
    can_change: true,
    ...overrides,
  };
}

const SHOWING = notice();
const EVERYONE = notice({
  id: "n-2",
  plant: null,
  text: "Canteen timing today: 12:30 to 13:15.",
  level: "normal",
  can_change: false,
});
const ENDED = notice({
  id: "n-3",
  text: "Old news",
  state: "ended",
  ended_at: "2026-10-19T10:00:00Z",
  ended_by: { id: "u-1", name: "Tushar Gawande" },
});

function answers(options: { me?: unknown; items?: Notice[] } = {}) {
  const { me = SUPER_ADMIN, items = [SHOWING, EVERYONE, ENDED] } = options;
  return {
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /notices": { body: { items, page: 1, page_size: 50, total: items.length } },
  };
}

async function listLoaded() {
  await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  await screen.findAllByText(/Old news|Gate 2|No gate notices/);
}

describe("gate notices: the list", () => {
  it("shows text, plant or All plants, level, times, state and who made it", async () => {
    mockApi(answers());

    renderRoute("/admin/notices");
    await listLoaded();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Gate 2 is closed for repair until 14:00.")).toBeInTheDocument();
    expect(within(table).getAllByText("K134")).toHaveLength(2); // the open and the ended one
    expect(within(table).getByText("All plants")).toBeInTheDocument();
    expect(within(table).getAllByText("Important")).toHaveLength(2);
    expect(within(table).getByText("Normal")).toBeInTheDocument();
    expect(within(table).getAllByText("Showing now")).toHaveLength(2);
    expect(within(table).getByText("Ended")).toBeInTheDocument();
    expect(within(table).getAllByText("Tushar Gawande").length).toBeGreaterThan(0);
    expect(within(table).getByText("Ended by Tushar Gawande")).toBeInTheDocument();
  });

  it("gives the Super Admin New notice, and Edit and End now only on notices that can change", async () => {
    mockApi(answers());

    renderRoute("/admin/notices");
    await listLoaded();

    expect(screen.getByRole("button", { name: "New notice" })).toBeInTheDocument();
    // One open notice can change; the all-plants one cannot (can_change false) and the ended one is over.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "End now" })).toHaveLength(1);
  });

  it("lets a Plant Head write for their plant but not change an all-plants notice", async () => {
    mockApi(answers({ me: PLANT_HEAD }));

    renderRoute("/admin/notices");
    await listLoaded();

    expect(screen.getByRole("button", { name: "New notice" })).toBeInTheDocument();
    expect(screen.getByText(/You write notices for your own plant/)).toBeInTheDocument();
    const everyoneRow = screen.getByText("Canteen timing today: 12:30 to 13:15.").closest("tr");
    expect(within(everyoneRow as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives the Corporate Head a read-only page", async () => {
    mockApi(answers({ me: CORPORATE_HEAD, items: [{ ...SHOWING, can_change: false }] }));

    renderRoute("/admin/notices");
    await listLoaded();

    expect(
      screen.getByText(/Read-only\. Only the Super Admin and the Plant Head/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New notice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the empty state and lets the filters narrow the list", async () => {
    const calls = mockApi(answers({ items: [] }));
    const user = userEvent.setup();

    renderRoute("/admin/notices");
    expect(await screen.findByText(/No gate notices yet/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("State"), "Ended");
    await user.click(screen.getByRole("button", { name: "Notices for all plants" }));

    await waitFor(() => {
      const last = new URLSearchParams(
        [...calls]
          .reverse()
          .find((c) => c.path.startsWith("/notices"))
          ?.path.split("?")[1],
      );
      expect(last.get("state")).toBe("ended");
      expect(last.get("all_plants")).toBe("true");
    });
  });
});

describe("gate notices: the form", () => {
  async function openNew(me: unknown = SUPER_ADMIN, items: Notice[] = []) {
    const calls = mockApi({
      ...answers({ me, items }),
      "POST /notices": { status: 201, body: notice({ id: "n-9" }) },
    });
    const user = userEvent.setup();
    renderRoute("/admin/notices");
    await user.click(await screen.findByRole("button", { name: "New notice" }));
    const dialog = await screen.findByRole("dialog");
    return { calls, user, dialog };
  }

  it("starts now and ends tonight at 23:59, and counts the characters", async () => {
    const { user, dialog } = await openNew();
    const today = istDateAndTime(new Date()).date;

    expect(within(dialog).getByLabelText("Start date")).toHaveValue(today);
    expect(within(dialog).getByLabelText("End date")).toHaveValue(today);
    expect(within(dialog).getByLabelText("End time")).toHaveValue("23:59");
    expect(within(dialog).getByText("0/200")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Notice text"), "Helmets needed");
    expect(within(dialog).getByText("14/200")).toBeInTheDocument();
  });

  it("previews the notice with the kiosk's own panel as you type, Important in amber", async () => {
    const { user, dialog } = await openNew();
    const preview = within(dialog).getByRole("complementary", { name: "How it looks at the gate" });
    expect(within(preview).getByText("Your notice appears here as you type.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Notice text"), "Truck unloading at Gate 1");
    expect(within(preview).getByText("Truck unloading at Gate 1")).toBeInTheDocument();
    expect(within(preview).queryByText("Important")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: /Important/ }));
    expect(within(preview).getByText("Important")).toBeInTheDocument();
  });

  it("keeps the text on one line", async () => {
    const { dialog } = await openNew();

    fireEvent.change(within(dialog).getByLabelText("Notice text"), {
      target: { value: "First line\nsecond line" },
    });

    expect(within(dialog).getByLabelText("Notice text")).toHaveValue("First line second line");
    expect(oneLine("a\r\nb\tc")).toBe("a b c");
  });

  it("will not save an empty notice or a bad date, and says why", async () => {
    const { calls, user, dialog } = await openNew();

    await user.click(within(dialog).getByRole("button", { name: "Save notice" }));
    expect(await within(dialog).findByText("Write 1 to 200 characters.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Notice text"), "Helmets needed");
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2020-01-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save notice" }));
    expect(await within(dialog).findByText("The end must be after the start.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("sends the notice for all plants with IST times as exact instants", async () => {
    const { calls, user, dialog } = await openNew();
    await user.type(within(dialog).getByLabelText("Notice text"), "  Helmets needed  ");
    await user.click(within(dialog).getByRole("radio", { name: /Important/ }));
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("Start time"), { target: { value: "08:00" } });
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2099-01-05" },
    });
    fireEvent.change(within(dialog).getByLabelText("End time"), { target: { value: "18:30" } });

    await user.click(within(dialog).getByRole("button", { name: "Save notice" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const sent = calls.find((call) => call.method === "POST")?.body;
    expect(sent).toEqual({
      plant_id: null,
      text: "Helmets needed",
      level: "important",
      starts_at: "2099-01-01T08:00:00+05:30",
      ends_at: "2099-01-05T18:30:00+05:30",
    });
  });

  it("lets the Super Admin choose a plant, but fixes a Plant Head to their own", async () => {
    const asBoss = await openNew();
    const plantSelect = within(asBoss.dialog).getByLabelText("Shown at");
    expect(within(plantSelect).getByRole("option", { name: "All plants" })).toBeInTheDocument();
    await asBoss.user.selectOptions(plantSelect, "K134 · Sheet Shapers (K-134)");
    expect(plantSelect).toHaveValue("p-1");
  });

  it("fixes a Plant Head's notice to their plant, without an All plants choice", async () => {
    const { dialog } = await openNew({ ...PLANT_HEAD, plant_ids: ["p-1"] });
    const plantSelect = within(dialog).getByLabelText("Shown at");

    expect(plantSelect).toBeDisabled();
    expect(plantSelect).toHaveValue("p-1");
    expect(
      within(plantSelect).queryByRole("option", { name: "All plants" }),
    ).not.toBeInTheDocument();
  });

  it("tells the server's refusal in words and keeps the form", async () => {
    mockApi({
      ...answers({ items: [] }),
      "POST /notices": apiError(422, "NOTICE_DATES_INVALID"),
    });
    const user = userEvent.setup();
    renderRoute("/admin/notices");
    await user.click(await screen.findByRole("button", { name: "New notice" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Notice text"), "Helmets needed");
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2099-01-05" },
    });

    await user.click(within(dialog).getByRole("button", { name: "Save notice" }));

    expect(
      await within(dialog).findByText(/The end must be after the start, at most 90 days/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits an open notice: the plant cannot change, only the changed fields are sent", async () => {
    const calls = mockApi({
      ...answers(),
      "PATCH /notices/n-1": { body: notice({ text: "Gate 2 open again." }) },
    });
    const user = userEvent.setup();
    renderRoute("/admin/notices");
    await listLoaded();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Shown at")).toBeDisabled();
    expect(within(dialog).getByLabelText("Notice text")).toHaveValue(
      "Gate 2 is closed for repair until 14:00.",
    );
    await user.clear(within(dialog).getByLabelText("Notice text"));
    await user.type(within(dialog).getByLabelText("Notice text"), "Gate 2 open again.");
    await user.click(within(dialog).getByRole("button", { name: "Save notice" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const sent = calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
    expect(sent.text).toBe("Gate 2 open again.");
    expect(sent).not.toHaveProperty("plant_id");
  });
});

describe("gate notices: End now", () => {
  it("asks first, says what happens, and ends the notice", async () => {
    const calls = mockApi({
      ...answers(),
      "POST /notices/n-1/end": { body: notice({ state: "ended" }) },
    });
    const user = userEvent.setup();
    renderRoute("/admin/notices");
    await listLoaded();

    await user.click(screen.getByRole("button", { name: "End now" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/stays in this list as Ended/)).toBeInTheDocument();
    expect(
      within(dialog).getByText("Gate 2 is closed for repair until 14:00."),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/notices/n-1/end")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "End now" }));

    await waitFor(() => expect(calls.some((call) => call.path === "/notices/n-1/end")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("tells when the notice had already ended", async () => {
    mockApi({ ...answers(), "POST /notices/n-1/end": apiError(409, "NOTICE_ENDED") });
    const user = userEvent.setup();
    renderRoute("/admin/notices");
    await listLoaded();

    await user.click(screen.getByRole("button", { name: "End now" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End now" }));

    expect(
      await within(dialog).findByText("This notice has ended and cannot be changed."),
    ).toBeInTheDocument();
  });
});

describe("gate notice form checks", () => {
  const base = {
    plantId: "",
    text: "Helmets needed",
    level: "normal" as const,
    startDate: "2099-01-01",
    startTime: "08:00",
    endDate: "2099-01-02",
    endTime: "08:00",
  };
  const now = Date.parse("2098-12-31T00:00:00Z");

  it("accepts a good notice and names the first problem otherwise", () => {
    expect(formProblem(base, now)).toBeNull();
    expect(formProblem({ ...base, text: "   " }, now)).toBe("notices.error.text");
    expect(formProblem({ ...base, text: "x".repeat(201) }, now)).toBe("notices.error.text");
    expect(formProblem({ ...base, text: "x".repeat(200) }, now)).toBeNull();
    expect(formProblem({ ...base, endDate: "2099-01-01", endTime: "08:00" }, now)).toBe(
      "notices.error.endBeforeStart",
    );
    expect(formProblem({ ...base, endDate: "2099-04-02" }, now)).toBe("notices.error.tooLong");
    expect(formProblem({ ...base, endDate: "2099-04-01" }, now)).toBeNull(); // exactly 90 days
    expect(formProblem(base, Date.parse("2099-02-01T00:00:00Z"))).toBe("notices.error.endPast");
  });
});
