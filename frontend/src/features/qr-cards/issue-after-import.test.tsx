// "Issue and print cards for these N employees" (F-38): after an Excel import and on an approved
// import request, for the Super Admin only.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate } from "../../lib/format";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, changeRequest, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /qr-cards/expiring-count": { body: { count: 0, days: 14 } },
};

const excel = () =>
  new File(["x"], "people.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

// A real import that created 3 people, 2 of whom punch by QR card.
function importAnswers(extra: Record<string, unknown> = {}, saved = {}) {
  return {
    ...LAYOUT,
    "GET /auth/me": { body: SUPER_ADMIN },
    "POST /employees/import": (call: { path: string }) =>
      call.path.includes("dry_run=true")
        ? { body: { ok_rows: 3, error_rows: 0, errors: [] } }
        : {
            body: {
              ok_rows: 3,
              error_rows: 0,
              errors: [],
              created: 3,
              created_employee_ids: ["e-1", "e-2", "e-3"],
              created_qr_employee_ids: ["e-2", "e-3"],
              ...saved,
            },
          },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

async function importFile(user: ReturnType<typeof userEvent.setup>, label = "Import 3 employees") {
  const input = await screen.findByLabelText("Choose an Excel file");
  fireEvent.change(input, { target: { files: [excel()] } });
  await user.click(await screen.findByRole("button", { name: label }));
}

beforeEach(() => {
  localStorage.clear();
  const tab = { location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  URL.createObjectURL = vi.fn(() => "blob:pdf");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("after an import (Super Admin)", () => {
  it("offers cards to the people who punch by QR and says who is left out", async () => {
    mockApi(importAnswers());
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);

    expect(await screen.findByText("Next step: ID cards")).toBeInTheDocument();
    expect(
      screen.getByText(/2 of these people punch by QR card and have no card yet\. 1 punch by face/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Issue and print cards for these 2 employees" }),
    ).toBeInTheDocument();
  });

  it("confirms with a reason, issues to exactly the QR people and shows the result", async () => {
    const calls = mockApi(
      importAnswers({
        "POST /qr-cards/bulk": {
          body: { done: 2, skipped: [], card_ids: ["c-1", "c-2"] },
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Issue and print cards for these 2 employees" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Issue cards to 2 employees")).toBeInTheDocument();
    expect(within(dialog).getByText("skipped: punch by face")).toBeInTheDocument();
    // the reason is suggested, and can be changed
    expect(within(dialog).getByLabelText("Reason")).toHaveValue(
      `New workers from the Excel import of ${formatDate(new Date())}`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Issue 2 cards" }));

    expect(await screen.findByText("2 cards issued")).toBeInTheDocument();
    expect(screen.getByText(/1 face employee got no card/)).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/qr-cards/bulk")?.body).toEqual({
      action: "issue",
      employee_ids: ["e-2", "e-3"],
      reason: `New workers from the Excel import of ${formatDate(new Date())}`,
    });
    expect(screen.getByRole("link", { name: "Go to QR cards" })).toHaveAttribute(
      "href",
      "/admin/qr-cards?printed=no",
    );
  });

  it("prints exactly the new cards", async () => {
    const calls = mockApi(
      importAnswers({
        "POST /qr-cards/bulk": { body: { done: 2, skipped: [], card_ids: ["c-1", "c-2"] } },
        "POST /qr-cards/print": { body: {} },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Issue and print cards for these 2 employees" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue 2 cards" }),
    );
    await user.click(await screen.findByRole("button", { name: "Print the 2 new cards (A4)" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-cards/print")?.body).toEqual({
        card_ids: ["c-1", "c-2"],
        layout: "a4_sheet",
      }),
    );
  });

  it("issues a big import in parts of 500 and offers printing in parts of 200", async () => {
    const qr = ids("e", 600);
    let made = 0;
    const calls = mockApi(
      importAnswers(
        {
          "POST /qr-cards/bulk": (call: { body: unknown }) => {
            const sent = (call.body as { employee_ids: string[] }).employee_ids;
            const cardIds = sent.map(() => `c-${++made}`);
            return { body: { done: sent.length, skipped: [], card_ids: cardIds } };
          },
        },
        { created: 600, created_employee_ids: qr, created_qr_employee_ids: qr },
      ),
    );
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user, "Import 3 employees");
    await user.click(
      await screen.findByRole("button", { name: "Issue and print cards for these 600 employees" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue 600 cards" }),
    );

    expect(await screen.findByText("600 cards issued")).toBeInTheDocument();
    const sizes = calls
      .filter((call) => call.path === "/qr-cards/bulk")
      .map((call) => (call.body as { employee_ids: string[] }).employee_ids.length);
    expect(sizes).toEqual([500, 100]);
    expect(screen.getByRole("button", { name: "Print cards 1–200 (A4)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print cards 401–600 (A4)" })).toBeInTheDocument();
  });

  it("keeps the dialog open and says why when issuing is refused", async () => {
    mockApi(importAnswers({ "POST /qr-cards/bulk": apiError(503, "QR_SIGNING_NOT_CONFIGURED") }));
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Issue and print cards for these 2 employees" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue 2 cards" }),
    );

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("2 cards issued")).not.toBeInTheDocument();
  });

  it("needs a reason before it issues", async () => {
    mockApi(importAnswers());
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);
    await user.click(
      await screen.findByRole("button", { name: "Issue and print cards for these 2 employees" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Reason"));

    expect(within(dialog).getByRole("button", { name: "Issue 2 cards" })).toBeDisabled();
  });

  it("says no cards are needed when everybody punches by face", async () => {
    mockApi(importAnswers({}, { created_qr_employee_ids: [] }));
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);

    expect(
      await screen.findByText(/No QR cards are needed for this file\. All 3 people punch by face/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Issue and print/ })).not.toBeInTheDocument();
  });
});

describe("after an import (Corporate Head)", () => {
  it("is sent for approval and told that only the Super Admin issues cards", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: CORPORATE_HEAD },
      "POST /employees/import": (call: { path: string }) =>
        call.path.includes("dry_run=true")
          ? { body: { ok_rows: 3, error_rows: 0, errors: [] } }
          : { status: 202, body: { change_request_id: "r-1", status: "pending", summary: "x" } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user, "Send 3 employees for approval");

    expect(
      await screen.findByText("Only the Super Admin issues and prints QR cards."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Issue and print/ })).not.toBeInTheDocument();
  });
});

describe("an approved import request", () => {
  const approved = (result: Record<string, unknown> | null) =>
    changeRequest({
      id: "r-9",
      kind: "employee.import",
      summary: "Import 3 employees from new-workers.xlsx",
      status: "approved",
      decided_at: "2026-10-20T09:00:00Z",
      result,
    });

  async function openRequest(me: unknown, request: ReturnType<typeof changeRequest>) {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: me },
      "GET /change-requests": page([request]),
    });
    const user = userEvent.setup();
    renderRoute("/admin/approvals");
    await user.click(await screen.findByText(/Import 3 employees from new-workers\.xlsx/));
  }

  it("offers cards to the Super Admin for the people it created", async () => {
    await openRequest(
      SUPER_ADMIN,
      approved({
        employee_ids: ["e-1", "e-2", "e-3"],
        created_employee_ids: ["e-1", "e-2", "e-3"],
        created_qr_employee_ids: ["e-2", "e-3"],
      }),
    );

    expect(await screen.findByText("Next step: ID cards")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Issue and print cards for these 2 employees" }),
    ).toBeInTheDocument();
  });

  it("offers nothing for an older request that did not record the new people", async () => {
    await openRequest(SUPER_ADMIN, approved({ employee_ids: ["e-1", "e-2"] }));

    await screen.findByRole("dialog");
    expect(screen.queryByText("Next step: ID cards")).not.toBeInTheDocument();
  });

  it("offers nothing while the request is still waiting", async () => {
    await openRequest(
      SUPER_ADMIN,
      changeRequest({
        id: "r-9",
        kind: "employee.import",
        summary: "Import 3 employees from new-workers.xlsx",
        status: "pending",
        result: null,
      }),
    );

    await screen.findByRole("dialog");
    expect(screen.queryByText("Next step: ID cards")).not.toBeInTheDocument();
  });
});

describe("a very small import", () => {
  it("speaks of one person in the singular when that person punches by face", async () => {
    mockApi(
      importAnswers({}, { created: 1, created_employee_ids: ["e-1"], created_qr_employee_ids: [] }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await importFile(user);

    expect(
      await screen.findByText(
        /The one person punches by face\. There is nobody to issue a card to/,
      ),
    ).toBeInTheDocument();
  });
});
