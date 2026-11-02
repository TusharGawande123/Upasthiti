// The bulk correction wizard "Correct many people" (F-59, spec M5 §4.7): the five steps, the preview
// with skipped people and their reasons, the Super Admin's create and reverse, a head's request,
// and the 200-people limit.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIst } from "@/lib/format";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { employee, PLANT_HEAD, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";

function dayOf(changes: Record<string, unknown> = {}) {
  return {
    date: todayIst(),
    plant: { id: "p-1", code: "K134" },
    shift: { id: "s-1", name: "Office" },
    employee_type: "permanent",
    day_kind: "working",
    status: "absent",
    code: "A",
    open_state: null,
    first_in: null,
    last_out: null,
    worked_min: 0,
    payable_min: 0,
    status_min: 0,
    shift_length_min: 480,
    extra_punch_count: 0,
    late_min: 0,
    early_exit_min: 0,
    overtime_min: 0,
    exceptions: [],
    is_corrected: false,
    pending_corrections: 0,
    uses_unchecked_flag: false,
    ...changes,
  };
}

const PREVIEW = {
  items: [
    {
      employee: { id: "e-1", code: "1001", name: "Ramesh Kulkarni" },
      before: dayOf(),
      after: dayOf({
        status: "present",
        code: "P",
        first_in: "2026-10-29T03:30:00Z",
        last_out: "2026-10-29T11:30:00Z",
        worked_min: 480,
      }),
      skip_code: null,
    },
    {
      employee: { id: "e-3", code: "1003", name: "Meera Deshmukh" },
      before: null,
      after: null,
      skip_code: "CORRECTION_NEAR_PUNCH",
    },
  ],
  will_create: 1,
  will_skip: 1,
};

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /regularisations": page([]),
    "GET /regularisations/summary": { body: { pending: 0, mine_pending: 0 } },
    "GET /employees": page([
      employee(),
      employee({ id: "e-3", employee_code: "1003", full_name: "Meera Deshmukh" }),
    ]),
    "POST /regularisations/bulk/preview": { body: PREVIEW },
    "POST /regularisations/bulk": {
      status: 201,
      body: {
        batch_id: "b-1",
        created: 1,
        skipped: [{ employee_id: "e-3", code: "CORRECTION_NEAR_PUNCH" }],
      },
    },
    "POST /regularisations/batches/b-1/reverse": { status: 201, body: { reversed: 1 } },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

async function goToPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Correct many people" }));
  const dialog = await screen.findByRole("dialog", { name: "Correct many people" });
  const next = () => user.click(within(dialog).getByRole("button", { name: "Next" }));

  // 1 Plant and day: the plant is needed.
  expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  await user.selectOptions(within(dialog).getByLabelText("Plant"), "p-1");
  await next();
  // 2 What to add: IN and OUT with 09:00 and 17:00 is the starting choice.
  expect(within(dialog).getByRole("radio", { name: "Add IN and OUT" })).toBeChecked();
  await next();
  // 3 People: at least one.
  expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  await user.click(await within(dialog).findByRole("checkbox", { name: /Ramesh Kulkarni/ }));
  await user.click(within(dialog).getByRole("checkbox", { name: /Meera Deshmukh/ }));
  expect(within(dialog).getByText("2 chosen, up to 200 allowed")).toBeInTheDocument();
  await next();
  // 4 Reason: 3 to 300 characters.
  expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  await user.type(within(dialog).getByLabelText("Reason"), "Attendance device was off all day");
  await next();
  return dialog;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the bulk correction wizard", () => {
  it("shows counts, the changes and the skipped people with the reason before anything is saved", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    const dialog = await goToPreview(user);

    expect(await within(dialog).findByText("people will change")).toBeInTheDocument();
    expect(within(dialog).getByText("will be skipped")).toBeInTheDocument();
    expect(within(dialog).getByText("Ramesh Kulkarni")).toBeInTheDocument();
    expect(within(dialog).getByText("Skipped")).toBeInTheDocument();
    expect(within(dialog).getByText("CORRECTION_NEAR_PUNCH")).toBeInTheDocument();
    expect(
      within(dialog).getByText("A counted punch is too close to this time"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Attendance device was off all day/)).toBeInTheDocument();
    // Nothing is stored by the preview.
    expect(posts(calls).map((call) => call.path)).toEqual(["/regularisations/bulk/preview"]);
    expect(posts(calls)[0]?.body).toMatchObject({
      plant_id: "p-1",
      attendance_date: todayIst(),
      kind: "add_in_out",
      employee_ids: ["e-1", "e-3"],
      reason: "Attendance device was off all day",
    });
  });

  it("creates and approves for the Super Admin, lists the skipped, and reverses the whole batch with a reason", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    const dialog = await goToPreview(user);
    await user.click(
      await within(dialog).findByRole("button", { name: "Create 1 corrections and approve all" }),
    );

    expect(await within(dialog).findByText("1 corrections made and approved")).toBeInTheDocument();
    expect(within(dialog).getByText("1 people were skipped.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Reverse the whole batch" }));
    const reverse = within(dialog).getByRole("button", { name: "Reverse the whole batch" });
    expect(reverse).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why is it reversed?"), "Wrong day chosen");
    await user.click(reverse);

    expect(
      await within(dialog).findByText(/The batch was reversed: 1 corrections undone/),
    ).toBeInTheDocument();
    const reverseCall = posts(calls).find(
      (call) => call.path === "/regularisations/batches/b-1/reverse",
    );
    expect(reverseCall?.body).toEqual({ reason: "Wrong day chosen" });
  });

  it("sends requests, with no reverse button, for a Plant Head", async () => {
    mockApi(base({ "GET /auth/me": { body: PLANT_HEAD } }));
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    const dialog = await goToPreview(user);
    await user.click(await within(dialog).findByRole("button", { name: "Send 1 requests" }));

    expect(
      await within(dialog).findByText("1 requests sent to the Super Admin"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Reverse the whole batch" }),
    ).not.toBeInTheDocument();
  });

  it("shows the server error when the preview fails", async () => {
    mockApi(base({ "POST /regularisations/bulk/preview": apiError(403, "FORBIDDEN") }));
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    const dialog = await goToPreview(user);

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: /Create|Send/ })).toBeDisabled();
  });

  it("goes back a step without losing what was typed", async () => {
    mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/corrections");
    const dialog = await goToPreview(user);
    await user.click(within(dialog).getByRole("button", { name: "Back" }));

    expect(within(dialog).getByLabelText("Reason")).toHaveValue(
      "Attendance device was off all day",
    );
  });
});
