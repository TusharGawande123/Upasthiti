// Employees list: paging and filters, selection and the bulk bar, and what each role sees.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import {
  CORPORATE_HEAD,
  employee,
  PLANT_HEAD,
  PLANT_K134,
  PLANT_X280,
  page,
  RAVI,
} from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /contractors": { body: [] },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("employees list", () => {
  it("shows people with type, plant, OT rate and a change-waiting marker", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": page([employee({ has_pending_change: true }), RAVI]),
    });

    renderRoute("/admin/employees");

    const row = (await screen.findByText("Ramesh Kulkarni")).closest("tr") as HTMLElement;
    expect(within(row).getByText("1001")).toBeInTheDocument();
    expect(within(row).getByText("Permanent")).toBeInTheDocument();
    expect(within(row).getByText("₹220.00/h")).toBeInTheDocument();
    expect(within(row).getByText("Change waiting")).toBeInTheDocument();
    const ravi = screen.getByText("Ravi Patil").closest("tr") as HTMLElement;
    expect(within(ravi).getByText("Temporary")).toBeInTheDocument();
    expect(within(ravi).getByText("Shree Manpower")).toBeInTheDocument();
    expect(within(ravi).getByText("Missing")).toBeInTheDocument();
  });

  it("shows the face state of face employees and 'Card' for QR employees (M3 F-40)", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": page([
        employee({ face_state: "enrolled" }),
        employee({ id: "e-3", full_name: "Mohan Deshmukh", face_state: "old_model" }),
        RAVI,
      ]),
    });

    renderRoute("/admin/employees");

    const row = (await screen.findByText("Ramesh Kulkarni")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Enrolled")).toBeInTheDocument();
    const old = screen.getByText("Mohan Deshmukh").closest("tr") as HTMLElement;
    expect(within(old).getByText("Old model")).toBeInTheDocument();
    const ravi = screen.getByText("Ravi Patil").closest("tr") as HTMLElement;
    expect(within(ravi).getByText("Card")).toBeInTheDocument();
  });

  it("filters by face state", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": page([employee()]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    await screen.findByText("Ramesh Kulkarni");
    await user.selectOptions(screen.getByLabelText("Face"), "not_enrolled");

    await vi.waitFor(() =>
      expect(calls.some((call) => call.path.includes("face_state=not_enrolled"))).toBe(true),
    );
  });

  it("asks the server for the plant chosen in the top bar, and remembers it", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": page([employee()]),
      "GET /plants/p-1/categories": { body: [] },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    await screen.findByText("Ramesh Kulkarni");
    await user.selectOptions(screen.getByLabelText("Plant filter"), "p-1");

    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.path.startsWith("/employees?") && call.path.includes("plant_id=p-1"),
        ),
      ).toBe(true),
    );
    expect(localStorage.getItem("upasthiti.plantFilter")).toBe("p-1");
  });

  it("searches by text after a short pause", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": page([employee()]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    await user.type(await screen.findByPlaceholderText("Search code or name"), "ram");

    await vi.waitFor(() => expect(calls.some((call) => call.path.includes("q=ram"))).toBe(true));
  });

  it("shows an empty state, and an error with a retry button", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN }, "GET /employees": page([]) });
    renderRoute("/admin/employees");
    expect(await screen.findByText(/No employees yet/)).toBeInTheDocument();
  });

  it("shows the error state with a retry button", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": apiError(500, "INTERNAL_ERROR"),
    });
    renderRoute("/admin/employees");
    expect(await screen.findByText(/went wrong on the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("bulk actions", () => {
  const people = page([
    employee(),
    employee({ id: "e-3", employee_code: "1018", full_name: "Anjali Deshpande" }),
    RAVI,
  ]);

  it("shows the bar for a selection and refuses people from different plants", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN }, "GET /employees": people });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    await user.click(await screen.findByRole("checkbox", { name: "Select Ramesh Kulkarni" }));
    expect(screen.getByRole("button", { name: "Move to shift" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Select Ravi Patil" }));

    expect(screen.getByText("Choose people from one plant only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to shift" })).toBeDisabled();
  });

  it("moves selected people to a shift with a reason (all or nothing)", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees": people,
      "GET /plants/p-1/shifts": {
        body: [
          {
            id: "s-2",
            plant_id: "p-1",
            name: "Night",
            start_time: "19:00:00",
            end_time: "07:00:00",
            crosses_midnight: true,
            grace_min: 10,
            half_day_min: 240,
            ot_after_min: 480,
            is_active: true,
          },
        ],
      },
      "GET /plants/p-1/categories": { body: [] },
      "GET /plants/p-1/departments": { body: [] },
      "POST /employees/bulk": { body: { updated: 2 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    await user.click(await screen.findByRole("checkbox", { name: "Select Ramesh Kulkarni" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Anjali Deshpande" }));
    await user.click(screen.getByRole("button", { name: "Move to shift" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("New shift"), "s-2");
    await user.type(within(dialog).getByLabelText("Reason"), "Press line moved");
    await user.click(within(dialog).getByRole("button", { name: "Move to shift" }));

    await vi.waitFor(() => {
      const sent = calls.find((call) => call.path === "/employees/bulk")?.body as Record<
        string,
        unknown
      >;
      expect(sent.action).toBe("change_shift");
      expect(sent.employee_ids).toEqual(["e-1", "e-3"]);
      expect((sent.params as Record<string, string>).shift_id).toBe("s-2");
      expect(sent.reason).toBe("Press line moved");
    });
  });

  it("says 'Send for approval' for a Corporate Head and never offers Mark as left", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: CORPORATE_HEAD }, "GET /employees": people });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    expect(await screen.findByText(/Your changes wait for the Super Admin/)).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: "Select Ramesh Kulkarni" }));

    expect(screen.getByText("Send for approval:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as left" })).not.toBeInTheDocument();
  });

  it("gives a Plant Head a read-only list without checkboxes or add buttons", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: PLANT_HEAD },
      "GET /employees": people,
    });

    renderRoute("/admin/employees");

    await screen.findByText("Ramesh Kulkarni");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add employee" })).not.toBeInTheDocument();
  });
});
