// The bulk dialog: each of the four actions sends the right parameters, the approval route for a
// Corporate Head, the reason rule, a refused change and closing with Cancel.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { BulkDialog } from "./bulk-dialog";
import type { BulkAction } from "./use-employees";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

const SHIFTS = [
  { id: "s-1", name: "General", is_active: true },
  { id: "s-2", name: "Old shift", is_active: false },
];
const CATEGORIES = [
  { id: "c-1", name: "Worker", is_active: true },
  { id: "c-2", name: "Retired category", is_active: false },
];
const DEPARTMENTS = [{ id: "d-1", name: "Assembly", is_active: true }];

function answers(extra: Record<string, unknown> = {}) {
  return {
    "GET /plants/p-1/shifts": { body: SHIFTS },
    "GET /plants/p-1/categories": { body: CATEGORIES },
    "GET /plants/p-1/departments": { body: DEPARTMENTS },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

function show(action: BulkAction | null, forApproval = false) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (current: BulkAction | null) => (
    <QueryClientProvider client={queryClient}>
      <BulkDialog
        action={current}
        plantId="p-1"
        employeeIds={["e-1", "e-2"]}
        forApproval={forApproval}
        onClose={onClose}
        onDone={onDone}
      />
    </QueryClientProvider>
  );
  render(view(action));
  return { onClose, onDone };
}

describe("bulk dialog", () => {
  it("renders nothing without an action", () => {
    mockApi(answers());
    show(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves people to an active shift from a date", async () => {
    const calls = mockApi(answers({ "POST /employees/bulk": { body: { updated: 2 } } }));
    const { onDone } = show("change_shift");
    const user = userEvent.setup();
    expect(await screen.findByRole("option", { name: "General" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old shift" })).toBeNull();

    const submit = screen.getByRole("button", { name: "Move to shift" });
    await user.type(screen.getByLabelText("Reason"), "Plant roster change");
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("New shift"), "s-1");
    await user.click(submit);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const sent = calls.find((call) => call.path === "/employees/bulk")?.body as {
      action: string;
      params: Record<string, string>;
    };
    expect(sent.action).toBe("change_shift");
    expect(sent.params.shift_id).toBe("s-1");
    expect(sent.params.from_date).toBeTruthy();
  });

  it("changes the category", async () => {
    const calls = mockApi(answers({ "POST /employees/bulk": { body: { updated: 2 } } }));
    const { onClose } = show("change_category");
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Worker" });
    await user.selectOptions(screen.getByLabelText("New category"), "c-1");
    await user.type(screen.getByLabelText("Reason"), "Regrade");
    await user.click(screen.getByRole("button", { name: "Move to category" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      (calls.find((call) => call.path === "/employees/bulk")?.body as never) ?? {},
    ).toMatchObject({ params: { category_id: "c-1" } });
  });

  it("clears the department when none is chosen", async () => {
    const calls = mockApi(answers({ "POST /employees/bulk": { body: { updated: 2 } } }));
    const { onDone } = show("change_department");
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Assembly" });
    await user.type(screen.getByLabelText("Reason"), "Reorganised");
    await user.click(screen.getByRole("button", { name: "Change department" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((call) => call.path === "/employees/bulk")?.body).toMatchObject({
      params: { department_id: null },
    });
  });

  it("marks people as left on a date, with no choice list", async () => {
    const calls = mockApi(answers({ "POST /employees/bulk": { body: { updated: 2 } } }));
    const { onDone } = show("mark_left");
    const user = userEvent.setup();
    expect(screen.queryByLabelText("New shift")).toBeNull();
    await user.type(await screen.findByLabelText("Reason"), "Contract ended");
    await user.click(screen.getByRole("button", { name: "Mark as left" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(
      (calls.find((call) => call.path === "/employees/bulk")?.body as { params: object }).params,
    ).toHaveProperty("left_on");
  });

  it("sends the change for approval when a Corporate Head asks", async () => {
    mockApi(
      answers({
        "POST /employees/bulk": { body: { change_request_id: "cr-1", status: "pending" } },
      }),
    );
    const { onDone } = show("change_department", true);
    const user = userEvent.setup();
    expect(
      await screen.findByText(/wait for the Super Admin/i, { exact: false }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "Reorganised");
    await user.click(screen.getByRole("button", { name: /approval/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the server's refusal and closes with Cancel", async () => {
    mockApi(answers({ "POST /employees/bulk": apiError(409, "EMPLOYEE_LEFT") }));
    const { onClose } = show("mark_left");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Reason"), "Contract ended");
    await user.click(screen.getByRole("button", { name: "Mark as left" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
