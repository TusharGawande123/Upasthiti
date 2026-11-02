// The employee's Attendance tab, the day drawer, the correction dialog and the one-day shift swap
// (spec M5 §4.5, §4.6, §4.7; design gate B screens 3 to 5): month, totals, heatmap, explanation
// sentences, timeline, role buttons, the preview before a correction is saved, swap create / cancel.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "@/lib/format";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { employee, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";

const MONTH = todayIst().slice(0, 7);
const DAY1 = `${MONTH}-01`;
const DAY2 = `${MONTH}-02`;

function dayOf(changes: Record<string, unknown> = {}) {
  return {
    date: DAY1,
    plant: { id: "p-1", code: "K134" },
    shift: { id: "s-1", name: "Office" },
    employee_type: "permanent",
    day_kind: "working",
    status: "half_day",
    code: "HD",
    open_state: null,
    first_in: "2026-10-29T04:10:00Z",
    last_out: "2026-10-29T11:30:00Z",
    worked_min: 440,
    payable_min: 440,
    status_min: 440,
    shift_length_min: 480,
    extra_punch_count: 1,
    late_min: 40,
    early_exit_min: 0,
    overtime_min: 0,
    exceptions: [],
    is_corrected: true,
    pending_corrections: 1,
    uses_unchecked_flag: false,
    ...changes,
  };
}

const TOTALS = {
  present: 19,
  half_day: 2,
  short_hours: 1,
  absent: 1,
  incomplete: 0,
  leave_paid: 1,
  leave_unpaid: 0,
  weekly_off: 3,
  holiday: 2,
  worked_on_off_day: 1,
  worked_min: 10140,
  overtime_min: 240,
  late_count: 4,
  late_min: 0,
  early_exit_count: 0,
};

const MONTH_ANSWER = {
  employee: { id: "e-1", code: "1001", name: "Ramesh Kulkarni" },
  days: [dayOf(), dayOf({ date: DAY2, status: "present", code: "P", is_corrected: false })],
  totals: TOTALS,
  leave: [
    {
      id: "l-1",
      from_date: DAY1,
      to_date: DAY2,
      is_paid: true,
      reason: "Fever",
      cancelled: false,
    },
  ],
  corrections: [
    {
      id: "c-1",
      employee: { id: "e-1", code: "1001", name: "Ramesh Kulkarni" },
      attendance_date: DAY1,
      kind: "ignore_punch",
      requested_by: { id: "u-3", name: "Nilesh Bhosale" },
      state: "pending",
    },
  ],
};

const YEAR_ANSWER = {
  months: [
    {
      month: MONTH,
      days: [
        { date: DAY1, code: "HD", is_corrected: true },
        { date: DAY2, code: "P", is_corrected: false },
      ],
    },
  ],
};

const SHIFT_RULES = {
  shift_id: "s-1",
  start_time: "09:00:00",
  end_time: "17:00:00",
  crosses_midnight: false,
  shift_length_min: 480,
  grace_min: 30,
  half_day_min: 240,
  overtime_min_minutes: 120,
  effective_from: "2026-01-01",
};

function detailOf(changes: Record<string, unknown> = {}) {
  return {
    day: dayOf(),
    explanation: [
      { key: "late", values: { time: "09:40", duration: "40 m", until: "09:30" } },
      { key: "outAt", values: { time: "17:00" } },
      {
        key: "workedForStatus",
        values: { worked: "7 h 20 m", full: "8 h", status: "half_day" },
      },
    ],
    shift_swap: null,
    shift_rules: SHIFT_RULES,
    window: { start: "2026-10-28T23:30:00Z", end: "2026-10-29T23:30:00Z" },
    timeline: [
      {
        kind: "punch",
        punch_id: "pu-1",
        punch_time: "2026-10-29T04:10:00Z",
        direction: "in",
        decision: "accepted",
        counts: true,
        role: "first_in",
        ignored_by_correction_id: null,
        kiosk: { id: "k-1", name: "Gate A" },
        method: "face",
        was_offline: false,
        carry_over: false,
      },
      {
        kind: "punch",
        punch_id: "pu-2",
        punch_time: "2026-10-29T07:28:00Z",
        direction: "out",
        decision: "accepted",
        counts: true,
        role: "extra",
        ignored_by_correction_id: null,
        kiosk: { id: "k-1", name: "Gate A" },
        method: "face",
        was_offline: false,
        carry_over: false,
      },
      {
        kind: "punch",
        punch_id: "pu-3",
        punch_time: "2026-10-29T08:01:00Z",
        direction: "in",
        decision: "flagged",
        counts: false,
        role: null,
        ignored_by_correction_id: "c-9",
        kiosk: { id: "k-1", name: "Gate A" },
        method: "face",
        was_offline: true,
        carry_over: false,
      },
      {
        kind: "review",
        punch_id: "pu-1",
        action: "approved",
        direction: "out",
        reviewed_by: { id: "u-1", name: "Asha Rao" },
        reviewed_at: "2026-10-30T04:42:00Z",
        reason: null,
      },
    ],
    allowed_correction_kinds: ["add_punch", "add_in_out", "ignore_punch", "set_status"],
    can_request: false,
    can_correct: true,
    ...changes,
  };
}

const NIGHT = {
  id: "s-2",
  plant_id: "p-1",
  name: "Night",
  start_time: "19:00:00",
  end_time: "07:00:00",
  crosses_midnight: true,
  shift_length_min: 720,
  grace_min: 30,
  half_day_min: 360,
  overtime_min_minutes: 120,
  is_active: true,
  rules_from: null,
  upcoming_rules: null,
};

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
    "GET /plants/p-1/shifts": { body: [NIGHT] },
    "GET /plants/p-1/categories": { body: [] },
    "GET /plants/p-1/departments": { body: [] },
    "GET /attendance/employee/e-1": { body: MONTH_ANSWER },
    "GET /attendance/employee/e-1/year": { body: YEAR_ANSWER },
    "GET /employees/e-1/shift-swaps": { body: [] },
    [`GET /attendance/employee/e-1/day/${DAY1}`]: { body: detailOf() },
    "GET /attendance/daily": page([]),
    "GET /attendance/undecided": { body: { short_hours: 0, incomplete: 0, plants: [] } },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

async function openTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Attendance" }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the Attendance tab", () => {
  it("shows the month calendar with codes, the totals, leave and corrections", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);

    expect(
      await screen.findByRole("button", { name: /Ramesh Kulkarni, day 1, HD, corrected/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ramesh Kulkarni, day 2, P" })).toBeInTheDocument();
    expect(screen.getByText("Present days").nextSibling).toHaveTextContent("19");
    expect(screen.getByText("Leave paid / unpaid").nextSibling).toHaveTextContent("1 / 0");
    expect(screen.getByText("Worked hours").nextSibling).toHaveTextContent("169 h");
    expect(screen.getByText(/· Fever/)).toBeInTheDocument();
    expect(screen.getByText("Ignore a punch")).toBeInTheDocument();
    expect(calls.some((call) => call.path === `/attendance/employee/e-1?month=${MONTH}`)).toBe(
      true,
    );
  });

  it("asks for the month the user picks", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);
    await screen.findByText("Month totals");
    await user.click(screen.getByRole("button", { name: "Previous month" }));

    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.startsWith("/attendance/employee/e-1?month=")).length,
      ).toBe(2),
    );
  });

  it("shows an error with a way to try again when the month cannot be loaded", async () => {
    mockApi(base({ "GET /attendance/employee/e-1": apiError(500, "INTERNAL_ERROR") }));
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("draws every heatmap square with its code and opens the day drawer from it", async () => {
    mockApi(base());
    const user = userEvent.setup();

    const router = renderRoute("/admin/employees/e-1");
    await openTab(user);

    const square = await screen.findByRole("button", {
      name: new RegExp(`Ramesh Kulkarni, day 1/${MONTH.slice(5)}, HD, corrected`),
    });
    expect(square).toHaveTextContent("HD");
    expect(screen.getByText("Last 12 months")).toBeInTheDocument();
    await user.click(square);

    expect(new URLSearchParams(router.state.location.search).get("day")).toBe(`e-1:${DAY1}`);
    expect(await screen.findByText("Explain this day")).toBeInTheDocument();
  });
});

describe("the day drawer", () => {
  it("shows the result, the server sentences and the timeline in words", async () => {
    mockApi(base());

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);

    expect(await screen.findByText("Explain this day")).toBeInTheDocument();
    expect(screen.getByText("IN at 09:40: 40 m late (on time until 09:30).")).toBeInTheDocument();
    expect(screen.getByText("OUT at 17:00.")).toBeInTheDocument();
    expect(
      screen.getByText("Worked for the status: 7 h 20 m of 8 h, so Half-day."),
    ).toBeInTheDocument();
    expect(screen.getByText("7 h 20 m of 8 h")).toBeInTheDocument();
    expect(screen.getByText(/Office 09:00-17:00 · full day 8 h/)).toBeInTheDocument();
    expect(screen.getByText("First IN: starts the hours")).toBeInTheDocument();
    expect(screen.getByText("Extra punch: not used for the hours")).toBeInTheDocument();
    expect(screen.getByText("Not used for this day")).toBeInTheDocument();
    expect(screen.getByText("Saved offline")).toBeInTheDocument();
    expect(screen.getByText("Approved as OUT")).toBeInTheDocument();
    expect(screen.getByText("Reason: only the Super Admin can see it")).toBeInTheDocument();
    expect(screen.getByText("1 correction pending")).toBeInTheDocument();
  });

  it("gives the Super Admin 'Correct' and a Plant Head 'Ask for a correction'", async () => {
    mockApi(base());
    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    expect(await screen.findByRole("button", { name: "Correct" })).toBeInTheDocument();
    expect(
      screen.getByText("You are the Super Admin: you can correct this day directly."),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();

    mockApi(
      base({
        "GET /auth/me": { body: PLANT_HEAD },
        [`GET /attendance/employee/e-1/day/${DAY1}`]: {
          body: detailOf({ can_correct: false, can_request: true }),
        },
      }),
    );
    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    const asks = await screen.findAllByRole("button", { name: "Ask for a correction" });
    expect(asks.length).toBeGreaterThan(0);
  });

  it("shows no correction button when the server allows no kind", async () => {
    mockApi(
      base({
        [`GET /attendance/employee/e-1/day/${DAY1}`]: {
          body: detailOf({ allowed_correction_kinds: [] }),
        },
      }),
    );

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);

    await screen.findByText("Explain this day");
    expect(screen.queryByRole("button", { name: "Correct" })).not.toBeInTheDocument();
  });

  it("shows a message and a retry when the day cannot be loaded", async () => {
    mockApi(base({ [`GET /attendance/employee/e-1/day/${DAY1}`]: apiError(404, "NOT_FOUND") }));

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the correction dialog", () => {
  function previewAnswer() {
    return {
      body: {
        before: dayOf({
          status: "short_hours",
          code: "SH",
          first_in: null,
          last_out: null,
          worked_min: 0,
        }),
        after: dayOf({ status: "present", code: "P" }),
        warnings: [],
      },
    };
  }

  it("shows the day before and after from the server, then saves at once for the Super Admin", async () => {
    const calls = mockApi(
      base({
        [`GET /attendance/employee/e-1/day/${DAY1}`]: {
          body: detailOf({ day: dayOf({ status: "short_hours", code: "SH" }) }),
        },
        "POST /regularisations/preview": previewAnswer(),
        "POST /regularisations": { status: 201, body: { correction: { id: "c-new" } } },
      }),
    );
    const user = userEvent.setup();

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    await user.click(await screen.findByRole("button", { name: "Correct" }));
    const dialog = await screen.findByRole("dialog", { name: "Correct this day" });
    // A Short-hours day starts on "Set the status".
    expect(within(dialog).getByRole("radio", { name: /Set the status/ })).toBeChecked();
    const save = within(dialog).getByRole("button", { name: "Save the correction" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Reason"), "Checked with the supervisor");

    expect(await within(dialog).findByText("Before")).toBeInTheDocument();
    expect(within(dialog).getByText("After")).toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(posts(calls).some((call) => call.path === "/regularisations")).toBe(true),
    );
    const sent = posts(calls).find((call) => call.path === "/regularisations") as RecordedCall;
    expect(sent.body).toMatchObject({
      employee_id: "e-1",
      attendance_date: DAY1,
      kind: "set_status",
      status_value: "present",
      reason: "Checked with the supervisor",
    });
  });

  it("sends a request, not a direct change, for a head", async () => {
    mockApi(
      base({
        "GET /auth/me": { body: PLANT_HEAD },
        [`GET /attendance/employee/e-1/day/${DAY1}`]: {
          body: detailOf({ can_correct: false, can_request: true }),
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    const buttons = await screen.findAllByRole("button", { name: "Ask for a correction" });
    await user.click(buttons[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog", { name: "Ask for a correction" });
    expect(within(dialog).getByRole("button", { name: "Send the request" })).toBeInTheDocument();
    expect(
      within(dialog).getByText("The Super Admin decides. Nothing changes until it is approved."),
    ).toBeInTheDocument();
  });

  it("shows the server's refusal as a warning and keeps the save button off", async () => {
    mockApi(
      base({
        "POST /regularisations/preview": apiError(422, "CORRECTION_NEAR_PUNCH"),
      }),
    );
    const user = userEvent.setup();

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    await user.click(await screen.findByRole("button", { name: "Correct" }));
    const dialog = await screen.findByRole("dialog", { name: "Correct this day" });
    await user.click(within(dialog).getByRole("radio", { name: /Add a punch/ }));
    await user.type(within(dialog).getByLabelText("Reason"), "Gate was down");

    const warnings = await within(dialog).findAllByText("A punch already covers this time.");
    expect(warnings.length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Save the correction" })).toBeDisabled();
  });

  it("does not allow 'Ignore a punch' when no punch counts", async () => {
    mockApi(
      base({
        [`GET /attendance/employee/e-1/day/${DAY1}`]: {
          body: detailOf({ timeline: [], day: dayOf({ status: "absent", code: "A" }) }),
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute(`/admin/attendance?day=e-1:${DAY1}`);
    await user.click(await screen.findByRole("button", { name: "Correct" }));

    const dialog = await screen.findByRole("dialog", { name: "Correct this day" });
    expect(within(dialog).getByRole("radio", { name: /Ignore a punch/ })).toBeDisabled();
    expect(within(dialog).getByText("This day has no punches to ignore.")).toBeInTheDocument();
  });
});

describe("the one-day shift swap", () => {
  const SWAP = {
    id: "sw-1",
    date: `${todayIst().slice(0, 4)}-12-31`,
    shift: { id: "s-2", name: "Night" },
    reason: "Cover for a sick colleague",
    created_by: "Asha Rao",
    created_at: "2026-10-30T04:00:00Z",
    cancelled: null,
  };

  it("lets the Super Admin make a swap with a date, a shift of the plant and a reason", async () => {
    const calls = mockApi(
      base({ "POST /employees/e-1/shift-swaps": { status: 201, body: { swap: SWAP } } }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);
    await user.click(await screen.findByRole("button", { name: "Work another shift on one day" }));

    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save the swap" });
    expect(save).toBeDisabled();
    await user.selectOptions(await within(dialog).findByLabelText("Shift (same plant)"), "s-2");
    await user.type(within(dialog).getByLabelText("Reason"), "Cover for a sick colleague");
    await user.click(save);

    await waitFor(() => expect(posts(calls).length).toBe(1));
    expect(posts(calls)[0]?.body).toEqual({
      date: todayIst(),
      shift_id: "s-2",
      reason: "Cover for a sick colleague",
    });
  });

  it("lists a swap and cancels it only with a reason", async () => {
    const calls = mockApi(
      base({
        "GET /employees/e-1/shift-swaps": { body: [SWAP] },
        "POST /shift-swaps/sw-1/cancel": {
          body: { swap: { ...SWAP, cancelled: { by: "Asha Rao", at: "x", reason: "r" } } },
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);
    expect(await screen.findByText(/Swapped to Night on 31\/12\//)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the swap" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Cancel this swap" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why is the swap cancelled?"), "Plan changed");
    await user.click(confirm);

    await waitFor(() => expect(posts(calls).length).toBe(1));
    expect(posts(calls)[0]?.body).toEqual({ reason: "Plan changed" });
  });

  it("shows the swap to a Plant Head without any button to change it", async () => {
    mockApi(
      base({
        "GET /auth/me": { body: PLANT_HEAD },
        "GET /employees/e-1/shift-swaps": { body: [SWAP] },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await openTab(user);

    expect(await screen.findByText(/Swapped to Night on 31\/12\//)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel the swap" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Work another shift on one day" }),
    ).not.toBeInTheDocument();
  });
});
