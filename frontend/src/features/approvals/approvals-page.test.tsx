// Approvals inbox (Super Admin) and My requests (Corporate Head): list, drawer, approve,
// reject with a reason, a request that can no longer be applied, and withdraw.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, changeRequest, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 2 } },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("approvals inbox", () => {
  it("lists waiting requests with who asked, and shows the count in the menu", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /change-requests": page([
        changeRequest(),
        changeRequest({
          id: "r-2",
          kind: "employee.import",
          summary: "Import 120 employees from TP2.xlsx",
        }),
      ]),
    });

    renderRoute("/admin/approvals");

    const row = (await screen.findByText(/Edit Ramesh Kulkarni/)).closest("tr") as HTMLElement;
    expect(within(row).getByText("Vikram Deshmukh")).toBeInTheDocument();
    expect(within(row).getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("Import 120 employees from TP2.xlsx")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Approvals/ })).toHaveTextContent("2");
  });

  it("shows an empty inbox", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN }, "GET /change-requests": page([]) });

    renderRoute("/admin/approvals");

    expect(await screen.findByText("Nothing is waiting")).toBeInTheDocument();
  });

  it("opens a request, shows the reason and what changes, and approves it", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /change-requests": page([changeRequest()]),
      "POST /change-requests/r-1/approve": { body: changeRequest({ status: "approved" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/approvals");
    await user.click(await screen.findByText(/Edit Ramesh Kulkarni/));
    const drawer = await screen.findByRole("dialog");

    expect(within(drawer).getByText("Nothing has changed yet.")).toBeInTheDocument();
    expect(within(drawer).getByText("New wage agreement")).toBeInTheDocument();
    expect(within(drawer).getByText("250.00")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Approve" }));

    await vi.waitFor(() =>
      expect(calls.some((call) => call.path === "/change-requests/r-1/approve")).toBe(true),
    );
  });

  it("rejects only with a reason", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /change-requests": page([changeRequest()]),
      "POST /change-requests/r-1/reject": { body: changeRequest({ status: "rejected" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/approvals");
    await user.click(await screen.findByText(/Edit Ramesh Kulkarni/));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: "Reject" }));
    const reasonDialog = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    expect(within(reasonDialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    await user.type(within(reasonDialog).getByLabelText("Reason"), "Not agreed with HR");
    await user.click(within(reasonDialog).getByRole("button", { name: "Reject" }));

    await vi.waitFor(() =>
      expect(calls.find((call) => call.path === "/change-requests/r-1/reject")?.body).toEqual({
        reason: "Not agreed with HR",
      }),
    );
  });

  it("explains when the change can no longer be applied", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /change-requests": page([
        changeRequest({
          kind: "employee.create",
          summary: "Add Asha Rao (1099)",
          payload: { values: { employee_code: "1099", full_name: "Asha Rao" } },
        }),
      ]),
      "POST /change-requests/r-1/approve": apiError(409, "REQUEST_CHECK_FAILED", {
        reason: "EMPLOYEE_CODE_EXISTS",
      }),
    });
    const user = userEvent.setup();

    renderRoute("/admin/approvals");
    await user.click(await screen.findByText(/Add Asha Rao/));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: "Approve" }));

    expect(await within(drawer).findByText(/can no longer be applied/)).toBeInTheDocument();
    expect(within(drawer).getByText(/already used/)).toBeInTheDocument();
  });

  it("keeps decided requests under History", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /change-requests": page([
        changeRequest({
          status: "rejected",
          decision_reason: "Wrong plant",
          decided_at: "2026-10-14T07:00:00Z",
        }),
      ]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/approvals");
    await user.click(await screen.findByRole("tab", { name: "History" }));

    expect(await screen.findByText("Rejected")).toBeInTheDocument();
  });
});

describe("my requests (Corporate Head)", () => {
  it("shows only their own list and lets them withdraw a waiting request", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /change-requests": page([changeRequest()]),
      "POST /change-requests/r-1/withdraw": { body: changeRequest({ status: "withdrawn" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/my-requests");
    expect(await screen.findByRole("heading", { name: "My requests" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Asked by" })).not.toBeInTheDocument();
    await user.click(await screen.findByText(/Edit Ramesh Kulkarni/));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Withdraw" }));

    await vi.waitFor(() =>
      expect(calls.some((call) => call.path === "/change-requests/r-1/withdraw")).toBe(true),
    );
  });
});
