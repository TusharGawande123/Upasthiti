// The admin side of phone punching (M4b P4): the "Phone attendance" card on the employee page,
// the "Phone" filter and tag of the employees list, bulk confirm in "Needs review", the punch log
// channel and tags, and the dashboard and card lines. Dates are pinned (today = 02/11/2026).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { punchItem } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";
import { answers, lastQuery, posts, row } from "../../test/review-fixtures";

const EMPLOYEE = {
  id: "e-1",
  employee_code: "E0412",
  full_name: "Sunita Jadhav",
  type: "permanent",
  plant_id: "p-1",
  plant_code: "K134",
  category_id: "c-1",
  category_name: "Staff",
  department_id: null,
  department_name: null,
  shift_id: "s-1",
  shift_name: "General",
  contractor_id: null,
  contractor_name: null,
  punch_method: "face",
  hourly_rate: null,
  ot_rate_per_hour: "150.00",
  status: "active",
  joined_on: "2026-01-05",
  left_on: null,
  left_reason: null,
  has_pending_change: false,
  phone_punch_enabled: true,
};

const PHONE_VIEW = {
  phone_punch_enabled: true,
  phone_changed_at: "2026-10-30T05:00:00Z",
  outside_work_allowed: true,
  outside_work_until: "2026-11-03",
  outside_work_ended: false,
  outside_changed_at: "2026-10-30T05:00:00Z",
  account: {
    state: "active",
    password_set_at: "2026-10-30T05:00:00Z",
    proof_kind: "face",
    locked_until: null,
  },
  notice: { version: "1", accepted_at: "2026-10-30T05:05:00Z" },
  sessions: [
    {
      id: "s-1",
      started_at: "2026-11-02T01:00:00Z",
      last_seen_at: "2026-11-02T03:00:00Z",
      expires_at: "2026-12-02T01:00:00Z",
      browser: "Chrome",
      system: "Android",
      ip: "203.0.113.7",
    },
  ],
  passkeys: [
    {
      id: "k-1",
      label: "Chrome on Android",
      created_at: "2026-10-31T05:00:00Z",
      last_used_at: null,
    },
  ],
};

function employeeAnswers(extra: Parameters<typeof mockApi>[0] = {}, role: object = SUPER_ADMIN) {
  return {
    "GET /auth/me": { body: role },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    "GET /reviews/summary": { body: { to_check: 0, rejected_last_7_days: 0, by_code: {} } },
    "GET /employees/e-1": {
      body: { employee: EMPLOYEE, shift_history: [], plant_history: [] },
    },
    "GET /employees/e-1/timeline": { body: [] },
    "GET /employees/e-1/face": { hang: true },
    "GET /employees/e-1/qr-cards": { body: { cards: [] } },
    "GET /employees/e-1/phone": { body: PHONE_VIEW },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T04:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Phone attendance card", () => {
  it("shows the account, the phones (with the IP for the Super Admin) and the passkeys", async () => {
    mockApi(employeeAnswers());
    renderRoute("/admin/employees/e-1");
    expect(await screen.findByText("Password set on 30/10/2026 by face check")).toBeInTheDocument();
    expect(screen.getByText("Accepted v1 on 30/10/2026")).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.7/)).toBeInTheDocument();
    expect(screen.getByText("Passkeys (1 of 3)")).toBeInTheDocument();
    expect(screen.getByText("Until 03/11/2026, the whole day counts")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Phone punching" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("switches phone punching off with a reason", async () => {
    const calls = mockApi(
      employeeAnswers({
        "PUT /employees/e-1/phone/access": { body: { ...PHONE_VIEW, phone_punch_enabled: false } },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("switch", { name: "Phone punching" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Outside work is switched off too.")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Switch off" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason (required)"), "Left the project");
    await user.click(confirm);
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        phone_punch_enabled: false,
        reason: "Left the project",
      }),
    );
  });

  it("turns outside work on with an end date and refuses a past date", async () => {
    const off = { ...PHONE_VIEW, outside_work_allowed: false, outside_work_until: null };
    const calls = mockApi(
      employeeAnswers({
        "GET /employees/e-1/phone": { body: off },
        "PUT /employees/e-1/phone/outside-work": { body: PHONE_VIEW },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("switch", { name: "Outside work allowed" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (required)"), "Customer visit");
    const until = within(dialog).getByLabelText("Until (optional)");
    await user.type(until, "2026-11-01");
    expect(within(dialog).getByText("The end date cannot be in the past.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Allow outside work" })).toBeDisabled();
    await user.clear(until);
    await user.type(until, "2026-11-05");
    await user.click(within(dialog).getByRole("button", { name: "Allow outside work" }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        allowed: true,
        reason: "Customer visit",
        until: "2026-11-05",
      }),
    );
  });

  it("explains why outside work is locked for a card worker", async () => {
    mockApi(
      employeeAnswers({
        "GET /employees/e-1": {
          body: {
            employee: { ...EMPLOYEE, punch_method: "qr" },
            shift_history: [],
            plant_history: [],
          },
        },
      }),
    );
    renderRoute("/admin/employees/e-1");
    expect(
      await screen.findByText("Outside work is only for employees who punch with their face."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Outside work allowed" })).toBeDisabled();
  });

  it("signs out all phones and says how many were signed out", async () => {
    const calls = mockApi(
      employeeAnswers({
        "POST /employees/e-1/phone/sign-out-all": { body: { ended: 1 } },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Sign out all phones" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (required)"), "Phone lost");
    await user.click(within(dialog).getByRole("button", { name: "Sign out 1 phone" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/sign-out-all"))?.body).toEqual({
        reason: "Phone lost",
      }),
    );
  });

  it("is read-only for a Plant Head: no IP, no buttons, switches disabled", async () => {
    mockApi(
      employeeAnswers(
        {
          "GET /employees/e-1/phone": {
            body: { ...PHONE_VIEW, sessions: [{ ...PHONE_VIEW.sessions[0], ip: null }] },
          },
        },
        PLANT_HEAD,
      ),
    );
    renderRoute("/admin/employees/e-1");
    expect(
      await screen.findByText(/Only the Super Admin can change phone attendance/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/203\.0\.113\.7/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out all phones" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Require a new password" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Phone punching" })).toBeDisabled();
  });

  it("shows the empty text when phone punching is off", async () => {
    mockApi(
      employeeAnswers({
        "GET /employees/e-1/phone": {
          body: {
            ...PHONE_VIEW,
            phone_punch_enabled: false,
            outside_work_allowed: false,
            sessions: [],
            passkeys: [],
          },
        },
      }),
    );
    renderRoute("/admin/employees/e-1");
    expect(
      await screen.findByText(
        "Phone punching is off. The employee punches only at the attendance device.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Switch phone punching on first.")).toBeInTheDocument();
  });

  it("shows a server refusal inside the dialog", async () => {
    mockApi(
      employeeAnswers({
        "PUT /employees/e-1/phone/access": apiError(409, "PHONE_ACCESS_UNCHANGED"),
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("switch", { name: "Phone punching" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (required)"), "Test reason");
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }));
    expect(
      await within(dialog).findByText("Phone punching is already switched this way."),
    ).toBeInTheDocument();
  });
});

describe("employees list", () => {
  it("filters by phone punching and shows the Phone tag", async () => {
    const calls = mockApi({
      ...employeeAnswers(),
      "GET /employees": page([EMPLOYEE]),
      "GET /contractors": { body: [] },
      "GET /plants/p-1/categories": { body: [] },
    } as never);
    const user = userEvent.setup();
    renderRoute("/admin/employees");
    expect(await screen.findByText("Sunita Jadhav")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Phone punching" }), "on");
    await waitFor(() => expect(lastQuery(calls, "/employees").get("phone")).toBe("on"));
  });
});

describe("Needs review: phone filter and bulk confirm (F-76)", () => {
  const CLEAN = row(
    punchItem({
      id: "pu-out-1",
      kiosk: null,
      method: "face",
      decision: "flagged",
      reason_codes: ["OUTSIDE_PLANT"],
      channel: "phone",
      outside_plant: true,
      review_state: "to_check",
    }),
    { bulk_confirmable: true, outside_reason: "Customer visit in Pune" },
  );
  const SINGLE = row(
    punchItem({
      id: "pu-edge-1",
      employee: { id: "e-3", code: "E0500", name: "Meena Patil" },
      kiosk: null,
      method: "face",
      decision: "flagged",
      reason_codes: ["LOCATION_AT_EDGE"],
      channel: "phone",
      review_state: "to_check",
    }),
    { bulk_confirmable: false },
  );

  it("asks for phone punches, ticks a clean row and confirms it with a note", async () => {
    const calls = mockApi(
      answers(
        {
          "POST /reviews/bulk-confirm": {
            body: { results: [{ punch_id: "pu-out-1", ok: true }] },
          },
        },
        [CLEAN, SINGLE],
      ),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review?channel=phone");
    expect(
      await screen.findByText("Outside work reason: Customer visit in Pune"),
    ).toBeInTheDocument();
    expect(lastQuery(calls, "/reviews").get("channel")).toBe("phone");
    expect(screen.getByText("Single review")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm selected (1)" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Checked with the manager");
    await user.click(within(dialog).getByRole("button", { name: "Confirm selected (1)" }));

    await waitFor(() =>
      expect(posts(calls).find((call) => call.path === "/reviews/bulk-confirm")?.body).toEqual({
        items: [{ punch_id: "pu-out-1", expected_latest_review_id: null }],
        note: "Checked with the manager",
      }),
    );
    expect(await screen.findByText("1 punch was confirmed.")).toBeInTheDocument();
  });

  it("says which punches need a single review after a partial answer", async () => {
    mockApi(
      answers(
        {
          "POST /reviews/bulk-confirm": {
            body: {
              results: [
                { punch_id: "pu-out-1", ok: true },
                { punch_id: "pu-out-2", ok: false, error_code: "REVIEW_CHANGED" },
              ],
            },
          },
        },
        [CLEAN, { ...CLEAN, punch: { ...CLEAN.punch, id: "pu-out-2" } }],
      ),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review?channel=phone");
    await screen.findAllByText("Outside work reason: Customer visit in Pune");
    for (const box of screen.getAllByRole("checkbox", { name: "Select" })) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Confirm selected (2)" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm selected (2)" }));
    expect(
      await screen.findByText("1 punch was confirmed; 1 needs a single review."),
    ).toBeInTheDocument();
  });

  it("shows no check boxes without the phone filter", async () => {
    mockApi(answers({}, [CLEAN]));
    renderRoute("/admin/review");
    await screen.findByText("Outside work reason: Customer visit in Pune");
    expect(screen.queryByRole("checkbox", { name: "Select" })).not.toBeInTheDocument();
  });
});

describe("punch log: channel, method and outside plant", () => {
  it("shows the channel, Phone code, the tag and the other plant line", async () => {
    const phoneCode = punchItem({
      id: "pu-gc",
      method: "gate_code",
      channel: "phone",
    });
    const outside = punchItem({
      id: "pu-out",
      employee: { id: "e-4", code: "E0412", name: "Sunita Jadhav" },
      kiosk: null,
      method: "face",
      decision: "flagged",
      reason_codes: ["OUTSIDE_PLANT"],
      channel: "phone",
      outside_plant: true,
      location_plant: { id: "p-2", name: "Sheet Shapers (X-280)", code: "X280" },
    });
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": page([PLANT_K134], 200),
      "GET /change-requests/pending-count": { body: { count: 0 } },
      "GET /qr-cards/expiring-count": { body: { count: 0 } },
      "GET /kiosks/status-summary": {
        body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
      },
      "GET /reviews/summary": { body: { to_check: 0, rejected_last_7_days: 0, by_code: {} } },
      "GET /kiosks": { body: [] },
      "GET /punches/summary": {
        body: {
          accepted_in: 2,
          accepted_out: 0,
          rejected: 0,
          dark_photos: 0,
          rejected_by_reason: {},
        },
      },
      "GET /punches": page([phoneCode, outside]),
    } as never);
    const user = userEvent.setup();
    renderRoute("/admin/punches?date=2026-11-02");
    expect(await screen.findByText("At plant X280 (own plant K134)")).toBeInTheDocument();
    // "Phone code" is also a choice of the method filter; the badge is the one inside the table.
    expect(within(screen.getByRole("table")).getByText("Phone code")).toBeInTheDocument();
    expect(screen.getAllByText("Outside plant").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByRole("combobox", { name: "Channel" }), "phone");
    await waitFor(() => expect(lastQuery(calls, "/punches").get("channel")).toBe("phone"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Outside plant" }), "yes");
    await waitFor(() => expect(lastQuery(calls, "/punches").get("outside_plant")).toBe("true"));
  });
});
