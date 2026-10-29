// The punch detail side sheet, M4 rows (spec M4 §4.9, AC-29): the punch time of a saved-offline
// punch with its time proof, the review mark and the link to "Needs review" for the Super Admin
// only, and the "asked for code" steps that every role sees.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { punchItem, rejectedPunch, summary } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";

const OFFLINE = punchItem({
  id: "pu-off",
  decision: "flagged",
  reason_codes: ["OFFLINE_TIME_UNPROVEN", "LOCATION_STALE"],
  review_state: "to_check",
  was_offline: true,
  offline_delay_seconds: 3600,
  punch_time: "2026-10-27T02:00:00Z",
  server_received_at: "2026-10-27T03:00:00Z",
});

function open(me: unknown, items: unknown[], detail: unknown) {
  mockApi({
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /reviews/summary": { body: { to_check: 0, rejected_last_7_days: 0, by_code: {} } },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    "GET /kiosks": { body: [] },
    "GET /punches": { body: { items, page: 1, page_size: 50, total: items.length } },
    "GET /punches/summary": { body: summary() },
    "GET /punches/pu-off": { body: detail },
    "GET /punches/pu-rej": { body: detail },
  });
  renderRoute("/admin/punches?date=2026-10-27");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function openDetails() {
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: /Details of the punch at/ });
  await user.click(button);
  return screen.findByRole("dialog");
}

describe("the punch detail of a saved-offline punch", () => {
  it("shows both times and an unproven time to the Super Admin, with a link to the review", async () => {
    const detail = { ...OFFLINE, app_version: "t", face: null, time_proof: "unproven" };
    open(SUPER_ADMIN, [OFFLINE], detail);

    const sheet = await openDetails();

    expect(await within(sheet).findByText("Punch time")).toBeInTheDocument();
    expect(within(sheet).getByText(/^Time not proven \(the device restarted/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Open in Needs review" })).toHaveAttribute(
      "href",
      "/admin/review?punch=pu-off",
    );
    expect(within(sheet).getByText("To check")).toBeInTheDocument();
  });

  it("shows a proven time and a review mark without the link to the Corporate Head", async () => {
    const reviewed = { ...OFFLINE, review_state: "not_accepted" as const };
    const detail = { ...reviewed, app_version: "t", face: null, time_proof: "anchored" };
    open(CORPORATE_HEAD, [reviewed], detail);

    const sheet = await openDetails();

    expect(
      await within(sheet).findByText(/Time proof: anchored to server time/),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Not accepted")).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("link", { name: "Open in Needs review" }),
    ).not.toBeInTheDocument();
  });

  it("offers the Super Admin a link to review a rejected punch nobody has reviewed", async () => {
    const rejected = rejectedPunch("OUTSIDE_GEOFENCE", {
      id: "pu-rej",
      server_received_at: "2026-10-27T03:00:00Z",
    });
    open(SUPER_ADMIN, [rejected], { ...rejected, app_version: "t", face: null });

    const sheet = await openDetails();

    expect(
      await within(sheet).findByRole("link", { name: "Open in Needs review" }),
    ).toHaveAttribute("href", "/admin/review?punch=pu-rej&tab=rejected");
  });

  it("gives the Corporate Head no review link for a rejected punch either", async () => {
    const rejected = rejectedPunch("OUTSIDE_GEOFENCE", {
      id: "pu-rej",
      server_received_at: "2026-10-27T03:00:00Z",
    });
    open(CORPORATE_HEAD, [rejected], { ...rejected, app_version: "t", face: null });

    const sheet = await openDetails();

    expect(
      (await within(sheet).findAllByText("Device outside the plant fence")).length,
    ).toBeGreaterThan(0);
    expect(
      within(sheet).queryByRole("link", { name: "Open in Needs review" }),
    ).not.toBeInTheDocument();
  });
});
