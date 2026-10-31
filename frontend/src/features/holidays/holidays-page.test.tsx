// The Holidays screen (/admin/holidays): grouped list, year picker, states, add and cancel for the
// Super Admin, and the read-only view of the other roles.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";

const YEAR = Number(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 4),
);

function holiday(changes: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    date: `${YEAR}-11-08`,
    name: "Diwali, Lakshmi Puja",
    is_paid: true,
    all_plants: true,
    plants: [],
    created_by: { id: "u-1", name: "Asha Rao" },
    created_at: "2026-10-01T04:00:00Z",
    cancelled: null,
    ...changes,
  };
}

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /holidays": { body: [holiday()] },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the holiday list", () => {
  it("groups holidays by month with their plants and pay", async () => {
    mockApi(
      base({
        "GET /holidays": {
          body: [
            holiday(),
            holiday({
              id: "h-2",
              date: `${YEAR}-11-11`,
              name: "Annual shutdown",
              is_paid: false,
              all_plants: false,
              plants: [
                { id: "p-1", code: "K134" },
                { id: "p-2", code: "X280" },
              ],
            }),
          ],
        },
      }),
    );

    renderRoute("/admin/holidays");

    expect(await screen.findByText("Diwali, Lakshmi Puja")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: `November ${YEAR}` })).toBeInTheDocument();
    expect(screen.getByText("K134, X280")).toBeInTheDocument();
    expect(screen.getByText("Unpaid")).toBeInTheDocument();
    expect(screen.getByText(`2 holidays in ${YEAR}`)).toBeInTheDocument();
  });

  it("shows a cancelled holiday struck through with its reason", async () => {
    mockApi(
      base({
        "GET /holidays": {
          body: [
            holiday({
              cancelled: {
                by: { id: "u-1", name: "Asha Rao" },
                at: "2026-10-31T04:00:00Z",
                reason: "Not a company holiday",
              },
            }),
          ],
        },
      }),
    );

    renderRoute("/admin/holidays");

    expect(await screen.findByText("Cancelled: Not a company holiday")).toBeInTheDocument();
    expect(screen.getByText("Diwali, Lakshmi Puja")).toHaveClass("line-through");
  });

  it("asks for another year when the arrows are used", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/holidays");
    await screen.findByText("Diwali, Lakshmi Puja");
    await user.click(screen.getByRole("button", { name: "Next year" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path.includes(`year=${YEAR + 1}`))).toBe(true),
    );
  });

  it("shows the empty state for a year without holidays", async () => {
    mockApi(base({ "GET /holidays": { body: [] } }));

    renderRoute("/admin/holidays");

    expect(await screen.findByText(`No holidays for ${YEAR} yet`)).toBeInTheDocument();
  });

  it("shows an error with Try again", async () => {
    mockApi(base({ "GET /holidays": apiError(500, "INTERNAL") }));

    renderRoute("/admin/holidays");

    expect(await screen.findByText(/The holidays could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the Super Admin", () => {
  it("adds a holiday for all plants, paid by default", async () => {
    const calls = mockApi(
      base({ "POST /holidays": { status: 201, body: { holiday: holiday() } } }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/holidays");
    await user.click(await screen.findByRole("button", { name: "Add holiday" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.clear(dialog.getByLabelText("Date"));
    await user.type(dialog.getByLabelText("Date"), `${YEAR}-12-25`);
    await user.type(dialog.getByLabelText("Name"), "Christmas");
    await user.click(dialog.getByRole("button", { name: "Save holiday" }));

    await waitFor(() => expect(posts(calls).map((call) => call.path)).toContain("/holidays"));
    expect(posts(calls).find((call) => call.path === "/holidays")?.body).toEqual({
      date: `${YEAR}-12-25`,
      name: "Christmas",
      is_paid: true,
      all_plants: true,
      plant_ids: [],
    });
  });

  it("needs at least one plant when plants are chosen, and a name of 2 characters", async () => {
    mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/holidays");
    await user.click(await screen.findByRole("button", { name: "Add holiday" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Name"), "A");
    expect(dialog.getByText("The name needs 2 to 80 characters.")).toBeInTheDocument();
    await user.type(dialog.getByLabelText("Name"), "B");
    await user.click(dialog.getByRole("radio", { name: /Chosen plants/ }));

    expect(dialog.getByText("Choose at least one plant.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save holiday" })).toBeDisabled();
    await user.click(await dialog.findByRole("checkbox", { name: /K134/ }));
    expect(dialog.getByRole("button", { name: "Save holiday" })).toBeEnabled();
  });

  it("shows the server message when a holiday already exists on the date", async () => {
    mockApi(base({ "POST /holidays": apiError(409, "HOLIDAY_EXISTS") }));
    const user = userEvent.setup();

    renderRoute("/admin/holidays");
    await user.click(await screen.findByRole("button", { name: "Add holiday" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Name"), "Again");
    await user.click(dialog.getByRole("button", { name: "Save holiday" }));

    expect(await dialog.findByText(/There is already a holiday/)).toBeInTheDocument();
  });

  it("cancels a holiday with a reason", async () => {
    const calls = mockApi(base({ "POST /holidays/h-1/cancel": { body: { holiday: holiday() } } }));
    const user = userEvent.setup();

    renderRoute("/admin/holidays");
    await user.click(await screen.findByRole("button", { name: /Cancel: Diwali/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const confirm = dialog.getByRole("button", { name: "Cancel" });
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByLabelText(/Why is it cancelled/), "Wrong date");
    await user.click(confirm);

    await waitFor(() =>
      expect(posts(calls).find((call) => call.path === "/holidays/h-1/cancel")?.body).toEqual({
        reason: "Wrong date",
      }),
    );
  });
});

describe("other roles", () => {
  it("shows a Corporate Head the holidays without Add or Cancel buttons", async () => {
    mockApi(base({ "GET /auth/me": { body: CORPORATE_HEAD } }));

    renderRoute("/admin/holidays");

    expect(await screen.findByText("Diwali, Lakshmi Puja")).toBeInTheDocument();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel:/ })).not.toBeInTheDocument();
  });
});
