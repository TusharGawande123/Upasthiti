// The review dialogs in their less common states (spec M4 §4.8, §7 rule 7): changing an approval,
// a server error, the reason limits, the direction choice and the photo of the second punch of a
// travel flag.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { punchItem, rejectedPunch } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";
import { answers, context, EDGE, OFFLINE, posts, row } from "../../test/review-fixtures";

const APPROVAL = {
  id: "r-9",
  action: "approved" as const,
  direction: "in" as const,
  reason: "Sent to the other plant",
  reviewed_by: { id: "u-1", name: "Tushar Gawande" },
  reviewed_at: "2026-10-27T05:00:00Z",
  supersedes_review_id: null,
};
const APPROVED = {
  ...rejectedPunch("WRONG_PLANT", { id: "pu-rej" }),
  review_state: "approved" as const,
  review_direction: "in" as const,
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function openChange() {
  const calls = mockApi(
    answers(
      {
        "GET /punches/pu-rej/review-context": {
          body: context(APPROVED, { reviews: [APPROVAL], approvable: true }),
        },
        "POST /punches/pu-rej/reviews": { status: 201, body: { review: {} } },
      },
      [row(APPROVED, { latest_review: APPROVAL, approvable: true })],
    ),
  );
  renderRoute("/admin/review?tab=reviewed");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Review the punch of Asha/ }));
  await user.click(await screen.findByRole("button", { name: "Change review" }));
  return { user, calls, dialog: await screen.findByRole("dialog", { name: "Change review" }) };
}

describe("changing an approval", () => {
  it("offers Approve again or Not accepted, and withdraws the approval with a reason", async () => {
    const { user, calls, dialog } = await openChange();

    expect(within(dialog).getByText("Now: Approved")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /Approve: the punch counts/ })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: /Not accepted/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), "Wrong person");
    await user.click(within(dialog).getByRole("button", { name: "Not accepted" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({
      action: "not_accepted",
      reason: "Wrong person",
      expected_latest_review_id: "r-9",
    });
  });

  it("changes the direction of the approval", async () => {
    const { user, dialog } = await openChange();

    await user.click(within(dialog).getByRole("radio", { name: /Count as OUT/ }));
    expect(within(dialog).getByRole("button", { name: "Approve as OUT" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /Count as IN/ }));
    expect(within(dialog).getByRole("button", { name: "Approve as IN" })).toBeInTheDocument();
  });

  it("refuses a reason that is too long and closes with Cancel", async () => {
    const { user, dialog } = await openChange();
    const reason = within(dialog).getByLabelText(/Reason/);

    await user.click(reason);
    await user.paste("x".repeat(320));
    await user.click(within(dialog).getByRole("button", { name: /^Approve as/ }));
    expect(
      within(dialog).getByText("The reason is too long. Use at most 300 characters."),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Change review" })).not.toBeInTheDocument(),
    );
  });
});

describe("a failed save", () => {
  it("shows the server's message and keeps the dialog open", async () => {
    mockApi(
      answers(
        {
          "GET /punches/pu-edge/review-context": { body: context(EDGE) },
          "POST /punches/pu-edge/reviews": apiError(409, "REVIEW_NOT_ALLOWED"),
        },
        [row(EDGE)],
      ),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha/ }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm this punch" });

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(
      await within(dialog).findByText("This action does not fit this punch. Nothing was saved."),
    ).toBeInTheDocument();
  });
});

describe("the second punch of a travel flag", () => {
  it("opens its photo from the card", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake-photo");
    URL.revokeObjectURL = vi.fn();
    const earlier = { ...punchItem({ id: "pu-far" }), app_version: null, face: null };
    const calls = mockApi(
      answers({
        "GET /punches/pu-offline/review-context": {
          body: context(OFFLINE, {
            related: [
              {
                punch: earlier,
                relation: "travel",
                distance_m: 2400,
                minutes_apart: 2,
                speed_kmh: 72,
              },
            ],
          }),
        },
        "GET /punches/pu-far/snapshot": { body: {} },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Ravi/ }));
    const sheet = await screen.findByRole("dialog");

    const photoButtons = await within(sheet).findAllByRole("button", { name: "View photo" });
    await user.click(photoButtons[0] as HTMLElement);

    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/snapshot"))).toBe(true));
  });
});
