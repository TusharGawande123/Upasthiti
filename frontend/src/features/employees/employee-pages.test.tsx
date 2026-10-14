// Employee form and detail: adding, editing, server field errors, the timeline, transfer, mark
// as left and reactivate, and the differences between the roles.
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, employee, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /contractors": {
    body: [
      {
        id: "ct-1",
        name: "Shree Manpower",
        contact_name: null,
        contact_phone: null,
        is_active: true,
        active_workers: 1,
      },
    ],
  },
};
const K134_LISTS = {
  "GET /plants/p-1/categories": {
    body: [
      { id: "c-1", plant_id: "p-1", name: "Staff", is_active: true },
      { id: "c-2", plant_id: "p-1", name: "Helper", is_active: true },
    ],
  },
  "GET /plants/p-1/departments": {
    body: [{ id: "d-1", plant_id: "p-1", name: "Accounts", is_active: true }],
  },
  "GET /plants/p-1/shifts": {
    body: [
      {
        id: "s-1",
        plant_id: "p-1",
        name: "General",
        start_time: "07:00:00",
        end_time: "19:00:00",
        crosses_midnight: false,
        grace_min: 10,
        half_day_min: 240,
        ot_after_min: 480,
        is_active: true,
      },
    ],
  },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("add employee", () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
    await within(await screen.findByLabelText("Plant")).findByRole("option", { name: /K134/ }); // plants loaded
    await user.selectOptions(screen.getByLabelText("Plant"), "p-1");
    await screen.findByRole("option", { name: "Staff" });
    await user.type(screen.getByLabelText("Code"), "ab-12");
    await user.type(screen.getByLabelText("Full name"), "Asha Rao");
    await user.selectOptions(screen.getByLabelText("Category"), "c-1");
    await user.selectOptions(screen.getByLabelText("Shift"), "s-1");
  }

  it("saves a permanent employee with the code in capitals", async () => {
    const calls = mockApi({
      ...LAYOUT,
      ...K134_LISTS,
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /employees": { status: 201, body: employee({ employee_code: "AB-12" }) },
      "GET /employees": page([]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/new");
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      const sent = calls.find((call) => call.method === "POST" && call.path === "/employees")
        ?.body as Record<string, unknown>;
      expect(sent).toMatchObject({
        employee_code: "AB-12",
        full_name: "Asha Rao",
        type: "permanent",
        plant_id: "p-1",
        category_id: "c-1",
        shift_id: "s-1",
        contractor_id: null,
        hourly_rate: null,
      });
    });
    // No phone number is asked for anywhere.
    expect(screen.queryByLabelText(/phone|mobile|contact/i)).not.toBeInTheDocument();
  });

  it("asks for an hourly rate and a contractor only for a temporary worker", async () => {
    mockApi({ ...LAYOUT, ...K134_LISTS, "GET /auth/me": { body: SUPER_ADMIN } });
    const user = userEvent.setup();

    renderRoute("/admin/employees/new");
    await screen.findByLabelText("Plant");
    expect(screen.queryByLabelText("Hourly rate")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Temporary/ }));

    expect(screen.getByLabelText("Hourly rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Contractor")).toBeInTheDocument();
  });

  it("shows field messages before sending anything", async () => {
    const calls = mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });
    const user = userEvent.setup();

    renderRoute("/admin/employees/new");
    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Use 1–12 letters, digits, / or -.")).toBeInTheDocument();
    expect(screen.getByText("Choose a category.")).toBeInTheDocument();
    expect(screen.getByText("Choose a shift.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("puts the server's message under the right field (code already used)", async () => {
    mockApi({
      ...LAYOUT,
      ...K134_LISTS,
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /employees": apiError(422, "EMPLOYEE_CODE_EXISTS", { field: "employee_code" }),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/new");
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/This employee code is already used/)).toBeInTheDocument();
  });

  it("says 'Send for approval' for a Corporate Head and accepts the 202 answer", async () => {
    const calls = mockApi({
      ...LAYOUT,
      ...K134_LISTS,
      "GET /auth/me": { body: CORPORATE_HEAD },
      "POST /employees": {
        status: 202,
        body: { change_request_id: "r-1", status: "pending", summary: "Add Asha Rao" },
      },
      "GET /employees": page([]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/new");
    expect(
      await screen.findByText(/This change will wait for the Super Admin/),
    ).toBeInTheDocument();
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Send for approval" }));

    await vi.waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.path === "/employees")).toBe(true),
    );
    expect(await screen.findByRole("heading", { name: "Employees" })).toBeInTheDocument();
  });
});

describe("edit employee", () => {
  it("locks the code and plant and sends only the changes", async () => {
    const calls = mockApi({
      ...LAYOUT,
      ...K134_LISTS,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees/e-1": {
        body: { employee: employee(), plant_history: [], shift_history: [] },
      },
      "PATCH /employees/e-1": { body: employee({ ot_rate_per_hour: "250.00" }) },
      "GET /employees/e-1/timeline": { body: [] },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1/edit");
    expect(await screen.findByLabelText("Code")).toBeDisabled();
    expect(screen.getByLabelText("Plant")).toBeDisabled();
    const rate = screen.getByLabelText("Overtime rate");
    await user.clear(rate);
    await user.type(rate, "250");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "New wage agreement" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      const sent = calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
      expect(sent.ot_rate_per_hour).toBe("250");
      expect(sent.reason).toBe("New wage agreement");
      expect(sent).not.toHaveProperty("employee_code");
      expect(sent).not.toHaveProperty("shift_from"); // the shift did not change
    });
  });
});

const DETAIL = {
  employee: employee(),
  plant_history: [
    { plant_id: "p-1", plant_code: "K134", from_date: "2026-10-09", to_date: null, reason: null },
    {
      plant_id: "p-2",
      plant_code: "X280",
      from_date: "2024-04-02",
      to_date: "2026-10-08",
      reason: "Moved with the press line",
    },
  ],
  shift_history: [
    { shift_id: "s-1", shift_name: "General", from_date: "2026-10-12", to_date: null },
  ],
};
const TIMELINE = [
  {
    at: "2026-10-12T10:35:00Z",
    action: "employee.transfer",
    actor_name: "Asha Rao",
    approved_through_request: true,
    changed_fields: ["plant_id", "category_id"],
    reason: "Moved with the press line",
  },
  {
    at: "2026-10-06T06:30:00Z",
    action: "employee.create",
    actor_name: "Asha Rao",
    approved_through_request: false,
    changed_fields: [],
    reason: null,
  },
];

describe("employee detail", () => {
  const answers = (me: unknown, detail = DETAIL) => ({
    ...LAYOUT,
    ...K134_LISTS,
    "GET /auth/me": { body: me },
    "GET /employees/e-1": { body: detail },
    "GET /employees/e-1/timeline": { body: TIMELINE },
  });

  it("shows details, plant history and a timeline with who, when and which fields", async () => {
    mockApi(answers(SUPER_ADMIN));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByRole("heading", { name: "Ramesh Kulkarni" })).toBeInTheDocument();
    expect(screen.getByText("Moved with the press line", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByText("Transferred")).toBeInTheDocument();
    expect(screen.getByText(/approved by the Super Admin/)).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    // The changed fields appear as small tags (the word also labels the details table).
    expect(screen.getAllByText("Category").length).toBeGreaterThan(1);
  });

  it("offers Mark as left to the Super Admin only, and never a delete button", async () => {
    mockApi(answers(CORPORATE_HEAD));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer to another plant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as left" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("marks someone as left with a date and a reason", async () => {
    const calls = mockApi({
      ...answers(SUPER_ADMIN),
      "POST /employees/e-1/mark-left": { body: employee({ status: "left" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Mark as left" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Left on"), { target: { value: "2026-10-14" } });
    await user.type(within(dialog).getByLabelText("Reason"), "Resigned");
    await user.click(within(dialog).getByRole("button", { name: "Mark as left" }));

    await vi.waitFor(() =>
      expect(calls.find((call) => call.path === "/employees/e-1/mark-left")?.body).toEqual({
        left_on: "2026-10-14",
        reason: "Resigned",
      }),
    );
  });

  it("reactivates a person who left (Super Admin)", async () => {
    const left = {
      ...DETAIL,
      employee: employee({ status: "left", left_on: "2026-10-01", left_reason: "Resigned" }),
    };
    const calls = mockApi({
      ...answers(SUPER_ADMIN, left),
      "POST /employees/e-1/reactivate": { body: employee() },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    expect(await screen.findByText(/Resigned/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Came back");
    await user.click(within(dialog).getByRole("button", { name: "Reactivate" }));

    await vi.waitFor(() =>
      expect(calls.find((call) => call.path === "/employees/e-1/reactivate")?.body).toMatchObject({
        reason: "Came back",
      }),
    );
  });

  it("transfers to another plant with an effective date", async () => {
    const calls = mockApi({
      ...answers(SUPER_ADMIN),
      "GET /plants/p-2/categories": {
        body: [{ id: "c-9", plant_id: "p-2", name: "Operator", is_active: true }],
      },
      "GET /plants/p-2/departments": { body: [] },
      "GET /plants/p-2/shifts": {
        body: [
          {
            id: "s-9",
            plant_id: "p-2",
            name: "General",
            start_time: "07:00:00",
            end_time: "19:00:00",
            crosses_midnight: false,
            grace_min: 10,
            half_day_min: 240,
            ot_after_min: 480,
            is_active: true,
          },
        ],
      },
      "POST /employees/e-1/transfer": { body: employee({ plant_id: "p-2", plant_code: "X280" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Transfer to another plant" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("New plant"), "p-2");
    await within(dialog).findByRole("option", { name: "Operator" });
    await user.selectOptions(within(dialog).getByLabelText("Category"), "c-9");
    await user.selectOptions(within(dialog).getByLabelText("Shift"), "s-9");
    fireEvent.change(within(dialog).getByLabelText("Starts on"), {
      target: { value: "2026-11-01" },
    });
    await user.type(within(dialog).getByLabelText("Reason"), "Plant closure");
    await user.click(within(dialog).getByRole("button", { name: "Transfer" }));

    await vi.waitFor(() =>
      expect(calls.find((call) => call.path === "/employees/e-1/transfer")?.body).toMatchObject({
        to_plant_id: "p-2",
        category_id: "c-9",
        shift_id: "s-9",
        effective_from: "2026-11-01",
        reason: "Plant closure",
      }),
    );
  });

  it("tells a Super Admin when a change waits for them", async () => {
    mockApi(answers(SUPER_ADMIN, { ...DETAIL, employee: employee({ has_pending_change: true }) }));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText(/A change is waiting for the Super Admin/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review request" })).toHaveAttribute(
      "href",
      "/admin/approvals",
    );
  });
});
