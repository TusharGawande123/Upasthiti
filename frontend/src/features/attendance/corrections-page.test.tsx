// The corrections list (/admin/corrections, spec M5 §4.7): tabs, request cards, the Super Admin's
// approve / reject / reverse, the requester's withdraw, the punch approvals and the role views.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { lastQuery, posts } from "../../test/review-fixtures";

function correction(changes: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    employee: { id: "e-1", code: "E1001", name: "Ramesh Kulkarni" },
    attendance_date: "2026-10-29",
    kind: "add_punch",
    direction: "out",
    in_time: null,
    out_time: "2026-10-29T11:30:00Z",
    status_value: null,
    punch_id: null,
    reverses_id: null,
    reason: "Gate was down at closing time",
    requested_by: { id: "u-3", name: "Sunil More" },
    requested_at: "2026-10-30T04:00:00Z",
    is_direct: false,
    batch_id: null,
    state: "pending",
    decision: null,
    ...changes,
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /regularisations": page([correction()]),
    "GET /regularisations/summary": { body: { pending: 1, mine_pending: 0 } },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the corrections list", () => {
  it("shows a pending request with its kind, times, reason and who asked", async () => {
    const calls = mockApi(base());

    renderRoute("/admin/corrections");

    expect(await screen.findByText("Ramesh Kulkarni")).toBeInTheDocument();
    expect(screen.getByText("Add a punch")).toBeInTheDocument();
    expect(screen.getByText("OUT 17:00")).toBeInTheDocument();
    expect(screen.getByText("Gate was down at closing time")).toBeInTheDocument();
    expect(screen.getByText(/Asked by Sunil More/)).toBeInTheDocument();
    expect(lastQuery(calls, "/regularisations").get("state")).toBe("pending");
  });

  it("lets the Super Admin approve a request", async () => {
    const calls = mockApi(
      base({ "POST /regularisations/c-1/approve": { body: { correction: correction() } } }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(posts(calls).map((call) => call.path)).toContain("/regularisations/c-1/approve"),
    );
  });

  it("needs a reason of at least 3 characters to reject", async () => {
    const calls = mockApi(
      base({ "POST /regularisations/c-1/reject": { body: { correction: correction() } } }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: "Reject this request" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Why is it rejected/), "No");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Why is it rejected/), " proof");
    await user.click(confirm);

    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ reason: "No proof" }));
  });

  it("shows the server's text when a request was already decided", async () => {
    mockApi(base({ "POST /regularisations/c-1/approve": apiError(409, "CORRECTION_NOT_PENDING") }));
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText("This request has already been decided.")).toBeInTheDocument();
  });

  it("shows decided requests and lets the Super Admin reverse an approved one", async () => {
    const calls = mockApi(
      base({
        "GET /regularisations": (call: RecordedCall) => {
          const state = new URLSearchParams(call.path.split("?")[1]).get("state");
          return page(state === "pending" ? [] : [correction({ id: "c-2", state: "approved" })]);
        },
        "POST /regularisations/c-2/reverse": { body: { correction: correction() } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await user.click(await screen.findByRole("tab", { name: "Decided" }));
    await user.click(await screen.findByRole("button", { name: "Reverse" }));
    await user.type(screen.getByLabelText("Why is it reversed?"), "Wrong person");
    await user.click(screen.getByRole("button", { name: "Reverse this correction" }));

    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ reason: "Wrong person" }));
    expect(lastQuery(calls, "/regularisations").get("state")).toBeTruthy();
  });

  it("shows the empty state", async () => {
    mockApi(base({ "GET /regularisations": page([]) }));

    renderRoute("/admin/corrections");

    expect(await screen.findByText("No requests waiting")).toBeInTheDocument();
  });

  it("shows the error state with a way to try again", async () => {
    mockApi(base({ "GET /regularisations": apiError(500, "INTERNAL_ERROR") }));

    renderRoute("/admin/corrections");

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("gives a head their own requests, a withdraw button and no approve button", async () => {
    const calls = mockApi(
      base({
        "GET /auth/me": { body: CORPORATE_HEAD },
        "GET /regularisations": page([correction({ requested_by: { id: "u-2", name: "Vikram" } })]),
        "POST /regularisations/c-1/withdraw": { body: { correction: correction() } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await screen.findByText("Ramesh Kulkarni");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the Super Admin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() =>
      expect(posts(calls).map((call) => call.path)).toContain("/regularisations/c-1/withdraw"),
    );

    await user.click(screen.getByRole("tab", { name: "My requests" }));
    await waitFor(() => expect(lastQuery(calls, "/regularisations").get("mine")).toBe("true"));
  });

  it("hides the My requests tab from the Super Admin", async () => {
    mockApi(base());

    renderRoute("/admin/corrections");

    await screen.findByText("Ramesh Kulkarni");
    expect(screen.queryByRole("tab", { name: "My requests" })).not.toBeInTheDocument();
  });

  it("lists punch approvals and hides the reason from the heads", async () => {
    const approval = {
      punch_id: "pu-1",
      punch_time: "2026-10-29T11:31:00Z",
      employee: { id: "e-1", code: "E1001", name: "Ramesh Kulkarni" },
      action: "approved",
      direction: "out",
      reviewed_by: { id: "u-1", name: "Tushar Gawande" },
      reviewed_at: "2026-10-30T05:00:00Z",
      reason: null,
    };
    const calls = mockApi(
      base({
        "GET /auth/me": { body: CORPORATE_HEAD },
        "GET /punch-approvals": page([approval]),
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    await user.click(await screen.findByRole("tab", { name: "Punch approvals" }));

    expect(await screen.findByText(/Approved · OUT/)).toBeInTheDocument();
    expect(screen.getByText("Reasons are only for the Super Admin")).toBeInTheDocument();
    expect(lastQuery(calls, "/punch-approvals").get("date_from")).toBeTruthy();
  });
});
