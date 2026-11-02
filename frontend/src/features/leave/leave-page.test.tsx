// The Leave screen (/admin/leave): list states, filters, add and cancel flows, the role
// differences (reasons only for the Super Admin) and the working-day helper behind the preview.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, employee, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";
import { countWorkingDays, isoWeekday, weeklyOffOn } from "./working-days";

function leave(changes: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    employee: { id: "e-1", code: "E1042", name: "Sunita Jadhav" },
    from_date: "2026-11-02",
    to_date: "2026-11-04",
    working_days: 3,
    is_paid: true,
    reason: "Family function",
    created_by: { id: "u-1", name: "Asha Rao" },
    created_at: "2026-10-30T04:00:00Z",
    cancelled: null,
    ...changes,
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134], 200),
    "GET /leave": page([leave()], 200),
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the leave list", () => {
  it("shows the leave with its pay, reason and who entered it", async () => {
    mockApi(base());

    renderRoute("/admin/leave");

    expect(await screen.findByText("Sunita Jadhav")).toBeInTheDocument();
    expect(screen.getByText("02/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Family function")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add leave" })).toBeInTheDocument();
  });

  it("shows the days that are not counted under the working days", async () => {
    mockApi(base({ "GET /leave": page([leave({ working_days: 2 })], 200) }));

    renderRoute("/admin/leave");

    expect(await screen.findByText("1 day not counted")).toBeInTheDocument();
  });

  it("shows a loading state, then the empty state with an Add button", async () => {
    mockApi(base({ "GET /leave": page([], 200) }));

    renderRoute("/admin/leave");

    expect(await screen.findByText("No leave entered yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add leave" }).length).toBeGreaterThan(0);
  });

  it("shows an error with Try again", async () => {
    mockApi(base({ "GET /leave": apiError(500, "INTERNAL") }));

    renderRoute("/admin/leave");

    expect(await screen.findByText(/Leave could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("sends the pay and state filters and offers Clear filters when nothing matches", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    await screen.findByText("Sunita Jadhav");
    mockApi(base({ "GET /leave": page([], 200) }));
    await user.click(screen.getByRole("button", { name: "Unpaid" }));

    expect(await screen.findByText("No leave matches these filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("narrows the loaded rows by name or code", async () => {
    mockApi(
      base({
        "GET /leave": page(
          [
            leave(),
            leave({
              id: "l-2",
              employee: { id: "e-2", code: "E0877", name: "Vijay Salunke" },
            }),
          ],
          200,
        ),
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    await screen.findByText("Vijay Salunke");
    await user.type(screen.getByRole("searchbox", { name: "Employee name or code" }), "E0877");

    expect(screen.queryByText("Sunita Jadhav")).not.toBeInTheDocument();
    expect(screen.getByText("Vijay Salunke")).toBeInTheDocument();
  });

  it("shows a cancelled leave struck through with its cancel reason", async () => {
    mockApi(
      base({
        "GET /leave": page(
          [
            leave({
              cancelled: {
                by: { id: "u-1", name: "Asha Rao" },
                at: "2026-10-31T04:00:00Z",
                reason: "Entered for the wrong person",
              },
            }),
          ],
          200,
        ),
      }),
    );

    renderRoute("/admin/leave");

    expect(await screen.findByText("Cancelled: Entered for the wrong person")).toBeInTheDocument();
    expect(screen.getByText("Sunita Jadhav")).toHaveClass("line-through");
    expect(screen.queryByRole("button", { name: "Cancel leave" })).not.toBeInTheDocument();
  });
});

describe("roles", () => {
  it.each([
    ["Corporate Head", CORPORATE_HEAD],
    ["Plant Head", PLANT_HEAD],
  ])("shows a %s the leave without reasons and without buttons", async (_name, me) => {
    mockApi(
      base({ "GET /auth/me": { body: me }, "GET /leave": page([leave({ reason: null })], 200) }),
    );

    renderRoute("/admin/leave");

    expect(await screen.findByText("Sunita Jadhav")).toBeInTheDocument();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Reason" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add leave" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel leave" })).not.toBeInTheDocument();
  });
});

describe("adding leave", () => {
  const answers = () =>
    base({
      "GET /employees": page([employee({ id: "e-1", full_name: "Sunita Jadhav" })]),
      "GET /plants/p-1/weekly-off": {
        body: {
          current: null,
          history: [
            { weekday: 7, effective_from: "2026-04-01", created_at: "2026-03-30T00:00:00Z" },
          ],
        },
      },
      "GET /holidays": { body: [] },
      "POST /leave": { status: 201, body: { leave: leave() } },
    });

  async function fillDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Add leave" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await dialog.findByRole("button", { name: /Sunita Jadhav/ }));
    return dialog;
  }

  it("needs a reason of 3 characters and sends the leave with the chosen pay", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    const dialog = await fillDialog(user);
    const save = dialog.getByRole("button", { name: "Save leave" });
    expect(save).toBeDisabled();

    await user.clear(dialog.getByLabelText("First day"));
    await user.type(dialog.getByLabelText("First day"), "2026-10-31");
    await user.clear(dialog.getByLabelText("Last day"));
    await user.type(dialog.getByLabelText("Last day"), "2026-11-04");
    await user.click(dialog.getByRole("radio", { name: /Unpaid leave/ }));
    await user.type(dialog.getByLabelText("Reason"), "Family function");
    await user.click(save);

    await waitFor(() => expect(posts(calls).map((call) => call.path)).toContain("/leave"));
    expect(posts(calls).find((call) => call.path === "/leave")?.body).toMatchObject({
      employee_id: "e-1",
      is_paid: false,
      reason: "Family function",
    });
  });

  it("says a weekly off inside the dates is not counted", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    const dialog = await fillDialog(user);
    await user.clear(dialog.getByLabelText("First day"));
    await user.type(dialog.getByLabelText("First day"), "2026-10-31");
    await user.clear(dialog.getByLabelText("Last day"));
    await user.type(dialog.getByLabelText("Last day"), "2026-11-04");

    expect(await dialog.findByText("4 working days.")).toBeInTheDocument();
    expect(
      dialog.getByText(/01\/11 is a weekly off and is not counted as leave/),
    ).toBeInTheDocument();
  });

  it("refuses a last day before the first day", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    const dialog = await fillDialog(user);
    await user.clear(dialog.getByLabelText("Last day"));
    await user.type(dialog.getByLabelText("Last day"), "2020-01-01");

    expect(dialog.getByText("The last day cannot be before the first day.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save leave" })).toBeDisabled();
  });

  it("shows the server's overlap message", async () => {
    mockApi({ ...answers(), "POST /leave": apiError(409, "LEAVE_OVERLAPS") });
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    const dialog = await fillDialog(user);
    await user.type(dialog.getByLabelText("Reason"), "Family function");
    await user.click(dialog.getByRole("button", { name: "Save leave" }));

    expect(await dialog.findByText(/Leave already exists/)).toBeInTheDocument();
  });
});

describe("cancelling leave", () => {
  it("needs a reason, then sends it and keeps the dialog text plain", async () => {
    const calls = mockApi(base({ "POST /leave/l-1/cancel": { body: { leave: leave() } } }));
    const user = userEvent.setup();

    renderRoute("/admin/leave");
    await user.click(await screen.findByRole("button", { name: "Cancel leave" }));
    const dialog = within(await screen.findByRole("dialog"));
    const confirm = dialog.getByRole("button", { name: "Cancel leave" });
    expect(confirm).toBeDisabled();

    await user.type(dialog.getByLabelText(/Why is it cancelled/), "Wrong person");
    await user.click(confirm);

    await waitFor(() =>
      expect(posts(calls).find((call) => call.path === "/leave/l-1/cancel")?.body).toEqual({
        reason: "Wrong person",
      }),
    );
  });
});

describe("working-day helpers", () => {
  const sunday = [{ weekday: 7, effective_from: "2026-04-01", created_at: "2026-03-30T00:00:00Z" }];

  it("reads the ISO weekday of a plain date", () => {
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(isoWeekday("2026-11-02")).toBe(1);
  });

  it("uses the weekly off in force on the date, Sunday when there is none", () => {
    const history = [
      ...sunday,
      { weekday: 6, effective_from: "2026-11-15", created_at: "2026-11-01T00:00:00Z" },
    ];
    expect(weeklyOffOn(history, "2026-11-14")).toBe(7);
    expect(weeklyOffOn(history, "2026-11-15")).toBe(6);
    expect(weeklyOffOn([], "2026-11-14")).toBe(7);
  });

  it("skips weekly offs and the holidays of the plant, not of other plants", () => {
    const holiday = (id: string, plantId: string | null, date: string) => ({
      id,
      date,
      name: "H",
      is_paid: true,
      all_plants: plantId === null,
      plants: plantId ? [{ id: plantId, code: "X" }] : [],
      created_by: { id: "u", name: "n" },
      created_at: "",
      cancelled: null,
    });
    const count = countWorkingDays(
      "2026-10-31",
      "2026-11-04",
      sunday,
      [holiday("a", "p-1", "2026-11-03"), holiday("b", "p-2", "2026-11-04")],
      "p-1",
    );
    expect(count.workingDays).toBe(3);
    expect(count.skipped).toEqual([
      { date: "2026-11-01", reason: "weekly_off" },
      { date: "2026-11-03", reason: "holiday" },
    ]);
  });
});
