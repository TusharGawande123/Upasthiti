// "Needs review": the other tabs, empty states, paging and filters, and the states of the review
// panel (time proof, what counts after a review, repeat scans, hints, walking through the queue,
// the photo, errors). Spec M4 §4.8; AC-24, AC-25, AC-43.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { rejectedPunch } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";
import { answers, context, EDGE, lastQuery, OFFLINE, row } from "../../test/review-fixtures";

const REVIEW = {
  id: "r-1",
  action: "confirmed" as const,
  direction: null,
  reason: "Checked with the shift supervisor",
  reviewed_by: { id: "u-1", name: "Tushar Gawande" },
  reviewed_at: "2026-10-27T05:00:00Z",
  supersedes_review_id: null,
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function openSheet(path: string, name: RegExp) {
  renderRoute(path);
  return screen.findByRole("button", { name });
}

describe("the other tabs, empty states and paging", () => {
  it("shows the reviewed tab with the review mark and an Open button", async () => {
    const confirmed = { ...EDGE, review_state: "confirmed" as const };
    mockApi(answers({}, [row(confirmed, { latest_review: REVIEW })]));

    renderRoute("/admin/review?tab=reviewed");

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review the punch of Asha Kale/ })).toHaveTextContent(
      "Open",
    );
  });

  it("explains each empty list in its own words", async () => {
    mockApi(answers({}, []));
    renderRoute("/admin/review?tab=rejected");
    expect(await screen.findByText("No rejected punches in these dates.")).toBeInTheDocument();
  });

  it("says so when nothing was reviewed", async () => {
    mockApi(answers({}, []));
    renderRoute("/admin/review?tab=reviewed");
    expect(await screen.findByText("No reviewed punches in these dates.")).toBeInTheDocument();
  });

  it("says no punch matches when a filter is set and the list is empty", async () => {
    mockApi(answers({}, []));
    renderRoute("/admin/review?code=LOCATION_AT_EDGE");
    expect(await screen.findByText("No punches match these filters.")).toBeInTheDocument();
  });

  it("opens the punch named in the address at once", async () => {
    mockApi(answers({ "GET /punches/pu-edge/review-context": { body: context(EDGE) } }));

    renderRoute("/admin/review?punch=pu-edge");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect((await screen.findAllByText(/At the edge of the fence/)).length).toBeGreaterThan(0);
  });

  it("pages through a long list", async () => {
    const calls = mockApi({
      ...answers(),
      "GET /reviews": { body: { items: [row(EDGE)], page: 1, page_size: 50, total: 120 } },
    });
    const user = userEvent.setup();
    renderRoute("/admin/review");

    await user.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() => expect(lastQuery(calls, "/reviews").get("page")).toBe("2"));
    await user.click(await screen.findByRole("button", { name: "Previous" }));
    await waitFor(() => expect(lastQuery(calls, "/reviews").get("page")).toBe("1"));
  });

  it("shows a try-again box when the list cannot be loaded", async () => {
    mockApi({ ...answers(), "GET /reviews": apiError(500, "INTERNAL_ERROR") });
    renderRoute("/admin/review");

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("searches after the typing stops and filters by device, method and code", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await screen.findByText("Ravi Shinde");

    await user.type(screen.getByRole("textbox", { name: "Employee code or name" }), "T-30");
    await waitFor(() => expect(lastQuery(calls, "/reviews").get("q")).toBe("T-30"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Attendance device" }), "k-1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Method" }), "face");
    await user.selectOptions(screen.getByRole("combobox", { name: "Code" }), "TWO_DEVICES_SOON");
    await waitFor(() => {
      const query = lastQuery(calls, "/reviews");
      expect(query.get("kiosk_id")).toBe("k-1");
      expect(query.get("method")).toBe("face");
      expect(query.get("code")).toBe("TWO_DEVICES_SOON");
    });
  });

  it("changes the dates and folds the filters behind a button on a phone", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await screen.findByText("Ravi Shinde");

    const toggle = screen.getByRole("button", { name: /^Filters \(\d\)$/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-05" } });

    await waitFor(() => {
      const query = lastQuery(calls, "/reviews");
      expect(query.get("date_from")).toBe("2026-10-01");
      expect(query.get("date_to")).toBe("2026-10-05");
    });
  });

  it("switches tabs from the tab bar", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await screen.findByText("Ravi Shinde");

    await user.click(screen.getByRole("tab", { name: "Rejected" }));
    await waitFor(() => expect(lastQuery(calls, "/reviews").get("tab")).toBe("rejected"));
    await user.click(screen.getByRole("tab", { name: /To check/ }));
    await waitFor(() => expect(lastQuery(calls, "/reviews").get("tab")).toBe("to_check"));
  });
});

describe("the states of the review panel", () => {
  it("shows a proven time, the counted direction after an approval and the history", async () => {
    const approved = {
      ...OFFLINE,
      review_state: "approved" as const,
      review_direction: "out" as const,
    };
    const review = { ...REVIEW, action: "approved" as const, direction: "out" as const };
    mockApi(
      answers(
        {
          "GET /punches/pu-offline/review-context": {
            body: context(approved, {
              punch: { ...context(approved).punch, time_proof: "anchored" },
              reviews: [review],
            }),
          },
        },
        [row(approved, { latest_review: review })],
      ),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review?tab=reviewed", /Review the punch of Ravi/));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Time proof: anchored to server time"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Counts as OUT")).toBeInTheDocument();
    expect(within(sheet).getByText("Checked with the shift supervisor")).toBeInTheDocument();
    expect(within(sheet).getByText(/Tushar Gawande/)).toBeInTheDocument();
    expect(within(sheet).getByText("current")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Change review" })).toBeInTheDocument();
  });

  it("says an online punch has the server's time and a not-accepted punch does not count", async () => {
    const notAccepted = { ...EDGE, review_state: "not_accepted" as const };
    mockApi(
      answers({ "GET /punches/pu-edge/review-context": { body: context(notAccepted) } }, [
        row(notAccepted, { latest_review: { ...REVIEW, action: "not_accepted" } }),
      ]),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review?tab=reviewed", /Review the punch of Asha/));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Same as the server time (online punch)."),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Does not count")).toBeInTheDocument();
  });

  it("shows that a confirmed punch counts without 'until you decide'", async () => {
    const confirmed = { ...EDGE, review_state: "confirmed" as const };
    mockApi(
      answers({ "GET /punches/pu-edge/review-context": { body: context(confirmed) } }, [
        row(confirmed, { latest_review: REVIEW }),
      ]),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review?tab=reviewed", /Review the punch of Asha/));

    expect(await screen.findByText("Counts as IN")).toBeInTheDocument();
  });

  it("calls a repeat scan a repeat scan and offers no action", async () => {
    const repeat = rejectedPunch("COOLDOWN_ACTIVE", { id: "pu-repeat" });
    mockApi(
      answers({ "GET /punches/pu-repeat/review-context": { body: context(repeat) } }, [
        row(repeat),
      ]),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review?tab=rejected", /Review the punch of Asha/));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("This punch was a repeat scan. It has nothing to approve."),
    ).toBeInTheDocument();
  });

  it("shows the hints in the singular, and the order flag with its other punch", async () => {
    mockApi(
      answers({
        "GET /punches/pu-edge/review-context": {
          body: context(EDGE, {
            hints: [
              { kind: "employee_rejections", count: 1, days: 7, filter: { tab: "rejected" } },
              { kind: "card_two_devices", count: 2, days: 7, filter: { tab: "to_check" } },
            ],
            related: [
              {
                punch: { ...context(OFFLINE).punch, id: "pu-next" },
                relation: "order",
                distance_m: null,
                minutes_apart: 30,
                speed_kmh: null,
              },
            ],
          }),
        },
      }),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review", /Review the punch of Asha/));

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/was rejected once this week/)).toBeInTheDocument();
    expect(within(sheet).getByText(/two attendance devices 2 times this week/)).toBeInTheDocument();
    expect(
      within(sheet).getByText("This punch was sent after a later punch was already decided"),
    ).toBeInTheDocument();
  });

  it("walks to the next and the previous punch with the arrows", async () => {
    const calls = mockApi(
      answers({
        "GET /punches/pu-edge/review-context": { body: context(EDGE) },
        "GET /punches/pu-offline/review-context": { body: context(OFFLINE) },
      }),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review", /Review the punch of Asha/));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Previous punch" })).toBeDisabled();

    await user.click(within(sheet).getByRole("button", { name: "Next punch" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/punches/pu-offline/review-context")).toBe(true),
    );
    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next punch" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous punch" }));
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
  });

  it("opens the photo through the audited photo dialog", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake-photo");
    URL.revokeObjectURL = vi.fn();
    const calls = mockApi(
      answers({
        "GET /punches/pu-edge/review-context": { body: context(EDGE) },
        "GET /punches/pu-edge/snapshot": { body: {} },
      }),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review", /Review the punch of Asha/));
    const sheet = await screen.findByRole("dialog");

    await user.click(await within(sheet).findByRole("button", { name: "View photo" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "/punches/pu-edge/snapshot")).toBe(true),
    );
  });

  it("shows why the panel could not load", async () => {
    mockApi(answers({ "GET /punches/pu-edge/review-context": apiError(404, "NOT_FOUND") }));
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review", /Review the punch of Asha/));

    expect(
      await within(await screen.findByRole("dialog")).findByText("Not found."),
    ).toBeInTheDocument();
  });

  it("closes the panel when the last punch of the list was reviewed", async () => {
    mockApi(
      answers(
        {
          "GET /punches/pu-edge/review-context": { body: context(EDGE) },
          "POST /punches/pu-edge/reviews": { status: 201, body: { review: {} } },
        },
        [row(EDGE)],
      ),
    );
    const user = userEvent.setup();
    await user.click(await openSheet("/admin/review", /Review the punch of Asha/));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm this punch" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
