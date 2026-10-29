// "Needs review": the tabs and filters, the review panel (flags, map line, hints, two punches,
// time proof, history) and the dialogs (confirm, not accepted, approve, change, REVIEW_CHANGED),
// the menu entry and the dashboard cards (spec M4 §4.8, §4.10; AC-24 to AC-29, AC-42, AC-43).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { PLANT_HEAD } from "../../test/people-fixtures";
import { punchItem } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";
import {
  answers,
  context,
  EDGE,
  lastQuery,
  NOBODY,
  OFFLINE,
  posts,
  row,
  SPOOF,
  SPOOF_ROW,
} from "../../test/review-fixtures";
import { distanceLine } from "./review-sheet";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the lists (AC-24)", () => {
  it("lists flagged punches to check with the badge count and the offline line", async () => {
    const calls = mockApi(answers());

    renderRoute("/admin/review");

    expect(await screen.findByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(await screen.findByText("Ravi Shinde")).toBeInTheDocument();
    expect(screen.getByText("Saved offline, sent 52 min later")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /To check.*7 to check/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const menu = screen.getByRole("navigation", { name: "Main menu" });
    expect(within(menu).getByRole("link", { name: /Needs review/ })).toHaveTextContent("7");
    expect(lastQuery(calls, "/reviews").get("tab")).toBe("to_check");
  });

  it("asks for the rejected tab and its filters, and says who a rejection names", async () => {
    const calls = mockApi(answers({}, [SPOOF_ROW, row(NOBODY)]));
    const user = userEvent.setup();

    renderRoute("/admin/review?tab=rejected");

    expect(await screen.findByText("Names an employee")).toBeInTheDocument();
    expect(screen.getAllByText("Names nobody")).toHaveLength(2); // the row and the filter choice
    expect(screen.getByText(/code typed/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Show already-punched/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Names an employee" }), "true");
    await waitFor(() => {
      const query = lastQuery(calls, "/reviews");
      expect(query.get("tab")).toBe("rejected");
      expect(query.get("include_cooldown")).toBe("true");
      expect(query.get("names_employee")).toBe("true");
    });
  });

  it("shows the empty state of the to-check list", async () => {
    mockApi(answers({}, []));

    renderRoute("/admin/review");

    expect(await screen.findByText("Nothing to check. Well done.")).toBeInTheDocument();
  });

  it("filters by saved offline and clears the filters again", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/review?code=LOCATION_AT_EDGE");
    await screen.findByText("Ravi Shinde");

    await user.selectOptions(screen.getByRole("combobox", { name: "Saved offline" }), "true");
    await waitFor(() => expect(lastQuery(calls, "/reviews").get("was_offline")).toBe("true"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      const query = lastQuery(calls, "/reviews");
      expect(query.get("was_offline")).toBeNull();
      expect(query.get("code")).toBeNull();
    });
  });
});

describe("the review panel (AC-25, AC-43)", () => {
  it("explains an edge flag: the distance line, the fence version, the hints", async () => {
    mockApi(
      answers({
        "GET /punches/pu-edge/review-context": {
          body: context(EDGE, {
            hints: [
              {
                kind: "device_edge_flags",
                count: 24,
                days: 7,
                filter: { tab: "to_check", kiosk_id: "k-1", code: "LOCATION_AT_EDGE" },
              },
            ],
          }),
        },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");

    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha Kale/ }));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("18 m outside the drawn fence, inside the 25 m margin"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/Fence version 3/)).toBeInTheDocument();
    expect(within(sheet).getByText(/24 fence-edge flags this week/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Show those punches" })).toHaveAttribute(
      "href",
      "/admin/review?tab=to_check&kiosk_id=k-1&code=LOCATION_AT_EDGE",
    );
    expect(within(sheet).getByText("Counts as IN until you decide")).toBeInTheDocument();
    expect(within(sheet).getByText("1 of 2")).toBeInTheDocument();
  });

  it("shows both punches of impossible travel with the speed, and an unproven time", async () => {
    const earlier = { ...punchItem({ id: "pu-far" }), app_version: null, face: null };
    mockApi(
      answers({
        "GET /punches/pu-offline/review-context": {
          body: context(OFFLINE, {
            punch: {
              ...OFFLINE,
              app_version: null,
              face: null,
              time_proof: "unproven",
            },
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
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");

    await user.click(
      await screen.findByRole("button", { name: /Review the punch of Ravi Shinde/ }),
    );

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("2.4 km in 2 min = 72 km/h; limit 60 km/h"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("Impossible travel between these two punches"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/Time not proven/)).toBeInTheDocument();
    expect(within(sheet).getByText("Delay")).toBeInTheDocument();
  });

  it("says when nobody is known and offers no action", async () => {
    mockApi(
      answers({ "GET /punches/pu-nobody/review-context": { body: context(NOBODY) } }, [
        row(NOBODY),
      ]),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review?tab=rejected");

    await user.click(await screen.findByRole("button", { name: /Review the punch of Unknown/ }));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("No employee is known for this punch."),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("the actions (AC-26 to AC-28)", () => {
  it("confirms with an optional note and opens the next punch", async () => {
    const calls = mockApi(
      answers({
        "GET /punches/pu-edge/review-context": { body: context(EDGE) },
        "GET /punches/pu-offline/review-context": { body: context(OFFLINE) },
        "POST /punches/pu-edge/reviews": { status: 201, body: { review: {} } },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha Kale/ }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm this punch" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({ action: "confirm", expected_latest_review_id: null });
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/punches/pu-offline/review-context")).toBe(true),
    );
  });

  it("needs a reason of 3 characters to mark a punch not accepted", async () => {
    const calls = mockApi(
      answers({
        "GET /punches/pu-edge/review-context": { body: context(EDGE) },
        "POST /punches/pu-edge/reviews": { status: 201, body: { review: {} } },
        "GET /punches/pu-offline/review-context": { body: context(OFFLINE) },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha Kale/ }));
    await user.click(await screen.findByRole("button", { name: "Not accepted" }));
    const dialog = await screen.findByRole("dialog", { name: "Not accepted" });
    expect(
      within(dialog).getByText("This punch will no longer count as IN/OUT."),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason/), "ab");
    await user.click(within(dialog).getByRole("button", { name: "Not accepted" }));
    expect(within(dialog).getByText("Write at least 3 characters.")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Reason/), "c device moved");
    await user.click(within(dialog).getByRole("button", { name: "Not accepted" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toMatchObject({
      action: "not_accepted",
      reason: "abc device moved",
    });
  });

  it("approves a rejected punch with the suggested direction and warns about a counted OUT", async () => {
    const calls = mockApi(
      answers(
        {
          "GET /punches/pu-spoof/review-context": {
            body: context(SPOOF, {
              approvable: true,
              claimed_employee: { id: "e-1", code: "T-2041", name: "Asha Kale" },
              suggestion: { direction: "out" },
              nearby_counted: [
                { punch_id: "pu-x", punch_time: "2026-10-27T02:33:00Z", direction: "out" },
              ],
            }),
          },
          "POST /punches/pu-spoof/reviews": { status: 201, body: { review: {} } },
        },
        [SPOOF_ROW],
      ),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review?tab=rejected");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha Kale/ }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/Code typed: T-2041/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Approve" }));

    const dialog = await screen.findByRole("dialog", { name: "Approve this punch" });
    expect(within(dialog).getByRole("radio", { name: /Count as OUT/ })).toBeChecked();
    expect(within(dialog).getByText("Suggested")).toBeInTheDocument();
    expect(within(dialog).getByText(/There is a counted OUT at 08:03/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Reason/), "Checked the photo");
    await user.click(within(dialog).getByRole("button", { name: "Approve as OUT" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({
      action: "approve",
      direction: "out",
      reason: "Checked the photo",
      expected_latest_review_id: null,
    });
  });

  it("tells the second Super Admin that the punch was reviewed meanwhile", async () => {
    const reviewed = context(EDGE, {
      reviews: [
        {
          id: "r-1",
          action: "confirmed",
          direction: null,
          reason: null,
          reviewed_by: { id: "u-9", name: "Second Admin" },
          reviewed_at: "2026-10-27T05:00:00Z",
          supersedes_review_id: null,
        },
      ],
    });
    const calls = mockApi(
      answers({
        "GET /punches/pu-edge/review-context": { body: reviewed },
        "POST /punches/pu-edge/reviews": apiError(409, "REVIEW_CHANGED"),
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin/review");
    await user.click(await screen.findByRole("button", { name: /Review the punch of Asha Kale/ }));
    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Second Admin · 27/10/2026 10:30:00"),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Change review" }));

    const dialog = await screen.findByRole("dialog", { name: "Change review" });
    expect(within(dialog).getByText("Now: Confirmed")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /Not accepted/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), "Device moved");
    await user.click(within(dialog).getByRole("button", { name: "Not accepted" }));

    expect(await within(dialog).findByText(/reviewed in the meantime/)).toBeInTheDocument();
    expect(posts(calls)[0]?.body).toMatchObject({ expected_latest_review_id: "r-1" });
    await user.click(within(dialog).getByRole("button", { name: "Load the latest" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Change review" })).not.toBeInTheDocument(),
    );
  });
});

describe("roles and the dashboard (AC-29, AC-42)", () => {
  it("hides the menu entry from a Plant Head", async () => {
    mockApi({ ...answers(), "GET /auth/me": { body: PLANT_HEAD } });

    renderRoute("/admin/punches");

    const menu = await screen.findByRole("navigation", { name: "Main menu" });
    expect(await within(menu).findByRole("link", { name: /Punch log/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: /Needs review/ })).not.toBeInTheDocument();
  });

  it("shows the to-check card and the daily digest with offline time in shifts", async () => {
    mockApi(
      answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
        "GET /reviews/digest": {
          body: {
            date: "2026-10-27",
            plants: [
              {
                plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
                flagged: 2,
                rejected_with_employee: 1,
                to_check: 1,
                device_offline_minutes_in_shifts: 120,
              },
            ],
          },
        },
      }),
    );

    renderRoute("/admin");

    expect(await screen.findByText("To check: 7 flagged punches")).toBeInTheDocument();
    expect(
      await screen.findByText("Attendance device offline in shifts: 2 h 0 min"),
    ).toBeInTheDocument();
    expect(screen.getByText("Flagged 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "K134" }).getAttribute("href")).toContain(
      "plant_id=p-1",
    );
  });
});

describe("the distance line", () => {
  const t = ((key: string, options?: Record<string, unknown>) =>
    `${key} ${JSON.stringify(options ?? {})}`) as unknown as Parameters<typeof distanceLine>[2];

  it("says inside, inside the margin or beyond it", () => {
    expect(distanceLine(null, 25, t)).toBeNull();
    expect(distanceLine(0, 25, t)).toContain("insideFence");
    expect(distanceLine(18.2, 25, t)).toContain('insideMargin {"metres":18,"margin":25}');
    expect(distanceLine(62, 25, t)).toContain('"beyond":37');
  });
});
