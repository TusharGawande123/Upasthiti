// The data-request register (/admin/privacy-requests, M6 spec 4.1): list, banner, add form and the
// steps in the sheet. All data is invented.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { employee, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";

function dataRequest(changes: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    kind: "access",
    channel: "in_person",
    received_on: "2026-11-01",
    due_on: "2026-12-01",
    note: null,
    status: "open",
    outcome: null,
    days_left: 26,
    employee_id: "e-1",
    employee_code: "1001",
    employee_name: "Ramesh Kulkarni",
    employee_left: false,
    created_at: "2026-11-01T05:00:00Z",
    ...changes,
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /data-requests": page([dataRequest()], 25),
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the register list", () => {
  it("shows the person, kind, status and the days left", async () => {
    mockApi(base());

    renderRoute("/admin/privacy-requests");

    expect(await screen.findByText("Ramesh Kulkarni")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("See my data")).toBeInTheDocument();
    expect(table.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("26 days left")).toBeInTheDocument();
  });

  it("shows an overdue request in words and the banner for requests due soon", async () => {
    mockApi(
      base({
        "GET /data-requests": (call: RecordedCall) =>
          call.path.includes("due_soon")
            ? { body: { items: [], page: 1, page_size: 1, total: 2 } }
            : page([dataRequest({ days_left: -3 })], 25),
      }),
    );

    renderRoute("/admin/privacy-requests");

    expect(await screen.findByText("Overdue 3 days")).toBeInTheDocument();
    expect(
      await screen.findByText("2 requests are due in 5 days or less (or late)."),
    ).toBeInTheDocument();
  });

  it("shows a friendly empty state and no banner", async () => {
    mockApi(base({ "GET /data-requests": page([], 25) }));

    renderRoute("/admin/privacy-requests");

    expect(await screen.findByText(/No requests yet/)).toBeInTheDocument();
    expect(screen.queryByText(/due in 5 days or less/)).not.toBeInTheDocument();
  });

  it("sends the filters to the server", async () => {
    const calls = mockApi(base());
    renderRoute("/admin/privacy-requests");
    await screen.findByText("Ramesh Kulkarni");

    await userEvent.selectOptions(screen.getByLabelText("Kind"), "erasure");
    await userEvent.click(screen.getByLabelText("Overdue only"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.path.includes("kind=erasure") && c.path.includes("overdue=true")),
      ).toBe(true),
    );
  });

  it("pages through a long list and goes back to page 1 when a filter changes", async () => {
    const calls = mockApi(
      base({
        "GET /data-requests": (call: RecordedCall) =>
          call.path.includes("due_soon")
            ? { body: { items: [], page: 1, page_size: 1, total: 0 } }
            : { body: { items: [dataRequest()], page: 1, page_size: 25, total: 60 } },
      }),
    );
    renderRoute("/admin/privacy-requests");
    await screen.findByText("Ramesh Kulkarni");
    expect(screen.getByText("Showing 1 of 60")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("page=2"))).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText("Kind"), "erasure");

    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("kind=erasure") && c.path.includes("page=1"))).toBe(
      true,
    );
  });

  it("shows an error with a retry button", async () => {
    mockApi(base({ "GET /data-requests": apiError(500, "INTERNAL_ERROR") }));

    renderRoute("/admin/privacy-requests");

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("adding a request", () => {
  it("sends the request with the chosen person and kind", async () => {
    const calls = mockApi(
      base({
        "GET /employees": page([employee()], 20),
        "POST /data-requests": { status: 201, body: { ...dataRequest(), events: [] } },
      }),
    );
    renderRoute("/admin/privacy-requests");
    await screen.findByText("Ramesh Kulkarni");

    await userEvent.click(screen.getByRole("button", { name: "Add request" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Kind of request"), "erasure");
    await userEvent.type(within(dialog).getByPlaceholderText(/Search by name/), "Ramesh");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Ramesh Kulkarni/ }));
    await userEvent.type(within(dialog).getByLabelText("Short note"), "Asked at the gate");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add request" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toMatchObject({
      kind: "erasure",
      channel: "in_person",
      employee_id: "e-1",
      note: "Asked at the gate",
    });
  });

  it("says that health details do not belong in the note", async () => {
    mockApi(base());
    renderRoute("/admin/privacy-requests");
    await userEvent.click(await screen.findByRole("button", { name: "Add request" }));

    expect(await screen.findByText("Do not write health details here.")).toBeInTheDocument();
  });
});

describe("the sheet of one request", () => {
  function sheetApi(detail: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return mockApi(
      base({
        "GET /data-requests/r-1": { body: detail },
        ...extra,
      }),
    );
  }

  it("offers only the next step and saves it", async () => {
    const calls = sheetApi(
      { ...dataRequest(), events: [] },
      {
        "POST /data-requests/r-1/events": {
          status: 201,
          body: { id: "ev-1", event_type: "identity_checked" },
        },
      },
    );
    renderRoute("/admin/privacy-requests");
    await userEvent.click(await screen.findByRole("button", { name: "01/11/2026" }));
    const dialog = await screen.findByRole("dialog");

    const stepSelect = await within(dialog).findByLabelText("Step");
    expect(within(stepSelect).getAllByRole("option")).toHaveLength(1);
    await userEvent.type(
      within(dialog).getByLabelText("What was done"),
      "ID card seen at the plant office",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save step" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({
      event_type: "identity_checked",
      detail: "ID card seen at the plant office",
    });
  });

  it("closing as partly done needs a reason of 10 characters", async () => {
    const calls = sheetApi(
      {
        ...dataRequest({ status: "answered", kind: "erasure" }),
        events: [
          {
            id: "ev-1",
            event_type: "answer_sent",
            detail: "Told in person",
            outcome: null,
            audit_entry_id: null,
            created_by: "u-1",
            created_by_name: "Tushar Gawande",
            created_at: "2026-11-02T05:00:00Z",
          },
        ],
      },
      { "POST /data-requests/r-1/events": { status: 201, body: { id: "ev-2" } } },
    );
    renderRoute("/admin/privacy-requests");
    await userEvent.click(await screen.findByRole("button", { name: "01/11/2026" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Told in person")).toBeInTheDocument();
    // An erasure starts on "Partly done" and explains why.
    expect(within(dialog).getByLabelText("Result")).toHaveValue("partly_done");
    expect(within(dialog).getByText(/closed as partly done/)).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save step" });
    expect(save).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Reason (at least 10 characters)"),
      "Records are kept by law",
    );
    await userEvent.click(save);

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({
      event_type: "closed",
      detail: "Records are kept by law",
      outcome: "partly_done",
    });
  });

  it("shows a closed request without a step form", async () => {
    sheetApi({
      ...dataRequest({ status: "closed", outcome: "done", days_left: null }),
      events: [],
    });
    renderRoute("/admin/privacy-requests");
    await userEvent.click(await screen.findByRole("button", { name: "01/11/2026" }));

    expect(await screen.findByText(/This request is closed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save step" })).not.toBeInTheDocument();
  });

  it("shows the server's words when a step is refused", async () => {
    sheetApi(
      { ...dataRequest(), events: [] },
      { "POST /data-requests/r-1/events": apiError(409, "DATA_REQUEST_STEP_INVALID") },
    );
    renderRoute("/admin/privacy-requests");
    await userEvent.click(await screen.findByRole("button", { name: "01/11/2026" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(await within(dialog).findByLabelText("What was done"), "ID seen");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save step" }));

    expect(
      await screen.findByText("This step cannot be added now. Check the steps that came before."),
    ).toBeInTheDocument();
  });
});
