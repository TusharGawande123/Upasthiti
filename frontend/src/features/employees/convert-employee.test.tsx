// Temporary to permanent (M5c): the dialog for both roles, the banners, the type history and the
// planned conversion. Fake server answers (no network).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, employee, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const WORKER = employee({
  id: "e-5",
  employee_code: "T-77",
  full_name: "Sunil More",
  type: "temporary",
  punch_method: "qr",
  hourly_rate: "85.00",
  contractor_id: "ct-1",
  contractor_name: "Shree Manpower",
  ot_rate_per_hour: null,
});
const DETAIL = (overrides: Record<string, unknown> = {}) => ({
  employee: WORKER,
  type_history: [],
  converted_on: null,
  conversion_scheduled_for: null,
  plant_history: [
    { plant_id: "p-1", plant_code: "K134", from_date: "2026-10-01", to_date: null, reason: null },
  ],
  shift_history: [
    { shift_id: "s-1", shift_name: "General", from_date: "2026-10-01", to_date: null },
  ],
  ...overrides,
});
const answers = (me: unknown, detail = DETAIL()) => ({
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /contractors": { body: [] },
  "GET /auth/me": { body: me },
  "GET /employees/e-5": { body: detail },
  "GET /employees/e-5/timeline": { body: [] },
  "GET /employees/e-5/qr-cards": { body: { cards: [] } },
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("convert to permanent", () => {
  it("lets the Super Admin convert and then go straight to the face enrolment", async () => {
    const calls = mockApi({
      ...answers(SUPER_ADMIN),
      "POST /employees/e-5/convert-to-permanent": { body: employee({ id: "e-5" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-5");
    await user.click(await screen.findByRole("button", { name: "Convert to permanent" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot punch until the Super Admin/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Reason"), "Permanent offer");
    await user.click(within(dialog).getByRole("button", { name: "Convert to permanent" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.path === "/employees/e-5/convert-to-permanent")?.body,
      ).toMatchObject({ reason: "Permanent offer" }),
    );
    expect(await screen.findByText("Converted to permanent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enrol face now" })).toBeInTheDocument();
  });

  it("makes the Corporate Head ask, and says it went to the Super Admin", async () => {
    const calls = mockApi({
      ...answers(CORPORATE_HEAD),
      "POST /employees/e-5/convert-to-permanent": {
        status: 202,
        body: { change_request_id: "r-1", status: "pending", summary: "Convert" },
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-5");
    await user.click(await screen.findByRole("button", { name: "Ask for conversion" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Permanent offer");
    await user.click(within(dialog).getByRole("button", { name: "Ask for conversion" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "/employees/e-5/convert-to-permanent")).toBe(true),
    );
    // The dialog closes (a message says it went to the Super Admin) and no enrolment is offered.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Enrol face now" })).not.toBeInTheDocument();
  });

  it("shows the server's reason when the conversion is refused", async () => {
    mockApi({
      ...answers(SUPER_ADMIN),
      "POST /employees/e-5/convert-to-permanent": {
        status: 422,
        body: {
          error: {
            code: "CONVERSION_DATE_INVALID",
            message: "Choose a valid date for the conversion.",
            details: { field: "effective_from" },
          },
        },
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-5");
    await user.click(await screen.findByRole("button", { name: "Convert to permanent" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Permanent offer");
    await user.click(within(dialog).getByRole("button", { name: "Convert to permanent" }));

    expect(
      await within(dialog).findByText("Choose a valid date for the conversion."),
    ).toBeInTheDocument();
  });

  it("hides the button from a Plant Head and for a permanent employee", async () => {
    mockApi(answers(PLANT_HEAD));
    renderRoute("/admin/employees/e-5");
    await screen.findByRole("heading", { name: "Sunil More" });
    expect(screen.queryByRole("button", { name: "Convert to permanent" })).not.toBeInTheDocument();
  });

  it("does not offer the conversion for a permanent employee", async () => {
    mockApi(answers(SUPER_ADMIN, DETAIL({ employee: employee({ id: "e-5", type: "permanent" }) })));
    renderRoute("/admin/employees/e-5");
    await screen.findByRole("heading", { name: "Ramesh Kulkarni" });
    expect(screen.queryByRole("button", { name: "Convert to permanent" })).not.toBeInTheDocument();
  });
});

describe("after a conversion", () => {
  const CONVERTED = DETAIL({
    employee: employee({
      id: "e-5",
      type: "permanent",
      face_enrolment_pending: true,
      face_state: "not_enrolled",
    }),
    converted_on: "2026-10-28",
    type_history: [
      { type: "temporary", from_date: "2026-10-01", to_date: "2026-10-27", reason: null },
      { type: "permanent", from_date: "2026-10-28", to_date: null, reason: "Permanent offer" },
    ],
  });

  it("shows the pending banner, a Converted tag and the type history", async () => {
    mockApi({
      ...answers(SUPER_ADMIN, CONVERTED),
      "GET /employees/e-5/face": { body: {} },
    });

    renderRoute("/admin/employees/e-5");

    expect(await screen.findByText("Face enrolment pending")).toBeInTheDocument();
    expect(screen.getByText(/cannot punch until their face is enrolled/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enrol face now" })).toHaveAttribute(
      "href",
      "/admin/employees/e-5?face=enrol",
    );
    expect(screen.getByText("Converted")).toBeInTheDocument();
    expect(screen.getByText("Type history")).toBeInTheDocument();
    expect(screen.getByText("Permanent offer", { selector: "span" })).toBeInTheDocument();
  });

  it("lets only the Super Admin cancel a planned conversion", async () => {
    const calls = mockApi({
      ...answers(SUPER_ADMIN, DETAIL({ conversion_scheduled_for: "2026-11-20" })),
      "DELETE /employees/e-5/convert-to-permanent": { body: WORKER },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-5");
    expect(await screen.findByText("Becomes permanent on 20/11/2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convert to permanent" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the planned conversion" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Changed my mind");
    await user.click(within(dialog).getByRole("button", { name: "Cancel the planned conversion" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.method === "DELETE" && call.path.includes("convert")),
      ).toBeTruthy(),
    );
  });
});
