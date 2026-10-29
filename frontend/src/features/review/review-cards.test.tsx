// The dashboard cards of "Needs review" (spec M4 §4.10, AC-42): the to-check number, the daily
// digest with its date arrows, its empty and error states, and who sees them (Super Admin only).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "../../lib/dates";
import { todayIst } from "../../lib/format";
import { apiError, mockApi, type RecordedCall } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { answers } from "../../test/review-fixtures";

const DIGEST = {
  date: "2026-10-27",
  plants: [
    {
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
      flagged: 0,
      rejected_with_employee: 0,
      to_check: 0,
      device_offline_minutes_in_shifts: 45,
    },
  ],
};

function lastQuery(calls: RecordedCall[], path: string): URLSearchParams {
  const call = [...calls].reverse().find((entry) => entry.path.split("?")[0] === path);
  return new URLSearchParams(call?.path.split("?")[1] ?? "");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the digest card", () => {
  it("walks back through the last 7 days with the arrows and stops at both ends", async () => {
    const calls = mockApi(
      answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
        "GET /reviews/digest": { body: DIGEST },
      }),
    );
    const user = userEvent.setup();
    renderRoute("/admin");
    const yesterday = addDays(todayIst(), -1);
    await screen.findByText("Daily review digest");
    await waitFor(() => expect(lastQuery(calls, "/reviews/digest").get("date")).toBe(yesterday));
    expect(screen.getByRole("button", { name: "Later day" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Earlier day" }));
    await waitFor(() =>
      expect(lastQuery(calls, "/reviews/digest").get("date")).toBe(addDays(yesterday, -1)),
    );
    expect(screen.getByText(/^Day /)).toBeInTheDocument();
    // Six more steps back reach the 7-day limit: the earlier arrow switches off.
    for (let step = 0; step < 6; step += 1) {
      await user.click(screen.getByRole("button", { name: "Earlier day" }));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Earlier day" })).toBeDisabled());
    await user.click(screen.getByRole("button", { name: "Later day" }));
    expect(screen.getByRole("button", { name: "Earlier day" })).toBeEnabled();
  });

  it("shows a quiet row when nothing happened and a message when there is no plant", async () => {
    mockApi(
      answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
        "GET /reviews/digest": { body: { date: "2026-10-27", plants: [] } },
      }),
    );
    renderRoute("/admin");

    expect(await screen.findByText("No plants yet.")).toBeInTheDocument();
  });

  it("shows the offline minutes of a quiet plant", async () => {
    mockApi(
      answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
        "GET /reviews/digest": { body: DIGEST },
      }),
    );
    renderRoute("/admin");

    const row = (await screen.findByRole("link", { name: "K134" })).closest("li") as HTMLElement;
    expect(within(row).getByText("Flagged 0")).toBeInTheDocument();
    expect(
      within(row).getByText("Attendance device offline in shifts: 45 min"),
    ).toBeInTheDocument();
  });

  it("says the numbers could not be loaded", async () => {
    mockApi(
      answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
        "GET /reviews/digest": apiError(500, "INTERNAL_ERROR"),
        "GET /reviews/summary": apiError(500, "INTERNAL_ERROR"),
      }),
    );
    renderRoute("/admin");

    expect((await screen.findAllByText("The numbers could not be loaded.")).length).toBeGreaterThan(
      0,
    );
  });
});

describe("who sees the review cards", () => {
  it("shows them to the Super Admin only", async () => {
    mockApi({
      ...answers({
        "GET /health": {
          body: { status: "ok", version: "dev", server_time: "2026-10-28T10:00:00Z" },
        },
      }),
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /plants": page([PLANT_K134], 200),
    });
    renderRoute("/admin");

    await screen.findByText(/Welcome/);
    expect(screen.queryByText("Daily review digest")).not.toBeInTheDocument();
    expect(screen.queryByText(/To check:/)).not.toBeInTheDocument();
  });
});
