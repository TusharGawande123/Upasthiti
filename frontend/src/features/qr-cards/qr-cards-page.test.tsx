// QR cards list: states with icon and word, filters sent to the server, and what each role sees.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import {
  CORPORATE_HEAD,
  PLANT_HEAD,
  PLANT_K134,
  PLANT_X280,
  page,
} from "../../test/people-fixtures";
import { cardRow, inDays } from "../../test/qr-card-fixtures";
import { renderRoute } from "../../test/render";
import { daysBetween } from "./card-badges";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /contractors": { body: [] },
  "GET /qr-test-cards": { body: [] },
};

const ROWS = [
  cardRow({ id: "e-1", code: "T-2041", name: "Sunil More" }, { serial: "C000123" }),
  cardRow(
    { id: "e-2", code: "T-2042", name: "Rekha Jagtap" },
    { serial: "C000031", state: "expiring", valid_until: inDays(8) },
  ),
  cardRow({ id: "e-3", code: "T-2043", name: "Mahesh Kadam" }, null),
  cardRow(
    { id: "e-4", code: "T-2044", name: "Poonam Zende" },
    {
      serial: "C000098",
      reprint_needed: true,
      printed_plant: { id: "p-2", name: "Sheet Shapers (X-280)", code: "X280" },
    },
  ),
  cardRow(
    { id: "e-5", code: "T-2047", name: "Kiran Shelar" },
    {
      serial: "C000067",
      state: "revoked",
      revoked_at: "2026-10-12T06:00:00Z",
      revoke_kind: "lost",
      revoke_reason: "Lost it",
    },
  ),
  cardRow(
    { id: "e-6", code: "T-2050", name: "Nisha Tambe" },
    { serial: "C000140", print_count: 0, last_printed_at: null },
  ),
  cardRow(
    { id: "e-7", code: "T-2046", name: "Anita Gaikwad" },
    { serial: "C000044", state: "expired", valid_until: inDays(-5) },
  ),
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("QR cards list", () => {
  it("shows each person's card with its state as an icon and a word", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Sunil More");
    const sunil = rowOf("Sunil More");
    expect(within(sunil).getByText("C000123")).toBeInTheDocument();
    expect(within(sunil).getByText("Active")).toBeInTheDocument();
    expect(within(sunil).getByText("1 time")).toBeInTheDocument();
    expect(within(sunil).getByText(/in 170 days/)).toBeInTheDocument();
    expect(within(rowOf("Rekha Jagtap")).getByText("Ends soon")).toBeInTheDocument();
    expect(within(rowOf("Rekha Jagtap")).getByText("in 8 days")).toBeInTheDocument();
    expect(within(rowOf("Mahesh Kadam")).getByText("No card")).toBeInTheDocument();
    expect(within(rowOf("Anita Gaikwad")).getByText("Expired")).toBeInTheDocument();
    expect(within(rowOf("Anita Gaikwad")).getByText("5 days ago")).toBeInTheDocument();
    const revoked = rowOf("Kiran Shelar");
    expect(within(revoked).getByText("Revoked")).toBeInTheDocument();
    expect(within(revoked).getByText("revoked 12/10/2026")).toBeInTheDocument();
    expect(within(rowOf("Nisha Tambe")).getByText("Not printed")).toBeInTheDocument();
  });

  it("flags a card that shows another plant than the person's plant now", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Poonam Zende");
    expect(
      within(rowOf("Poonam Zende")).getByText("Reprint needed (card shows X280)"),
    ).toBeInTheDocument();
    expect(within(rowOf("Sunil More")).queryByText(/Reprint needed/)).not.toBeInTheDocument();
  });

  it("shows a person who punches by face with the face label", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page([cardRow({ id: "e-9", name: "Santosh Chavan", punch_method: "face" })]),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Santosh Chavan");
    expect(within(rowOf("Santosh Chavan")).getByText("Marks with face")).toBeInTheDocument();
  });

  it("opens the employee when a row is clicked", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });
    const user = userEvent.setup();

    const router = renderRoute("/admin/qr-cards");
    await user.click(await screen.findByText("Mahesh Kadam"));

    // Pages load lazily, so the address changes once the next page has loaded.
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/employees/e-3"));
  });
});

describe("filters", () => {
  it("sends the chosen filters to the server and goes back to page 1", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await screen.findByText("Sunil More");
    await user.selectOptions(screen.getByLabelText("Card state"), "revoked");
    await user.selectOptions(screen.getByLabelText("Punch method"), "qr");
    await user.selectOptions(screen.getByLabelText("Printed"), "no");
    await user.click(screen.getByRole("button", { name: "Reprint needed" }));

    await vi.waitFor(() => {
      const last = calls.filter((call) => call.path.startsWith("/qr-cards?")).at(-1);
      expect(last?.path).toContain("state=revoked");
      expect(last?.path).toContain("punch_method=qr");
      expect(last?.path).toContain("printed=false");
      expect(last?.path).toContain("reprint_needed=true");
      expect(last?.path).toContain("page=1");
    });
  });

  it("searches by serial, name or code after a short pause", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await screen.findByText("Sunil More");
    await user.type(screen.getByLabelText("Search code, name or card serial"), "C000123");

    await vi.waitFor(() =>
      expect(calls.some((call) => call.path.includes("q=C000123"))).toBe(true),
    );
  });

  it("asks the server for the plant chosen in the top bar", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
      "GET /plants/p-1/categories": { body: [] },
    });
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await screen.findByText("Sunil More");
    await user.selectOptions(screen.getByLabelText("Plant filter"), "p-1");

    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.path.startsWith("/qr-cards?") && call.path.includes("plant_id=p-1"),
        ),
      ).toBe(true),
    );
  });
});

describe("empty, no match and error", () => {
  it("explains an empty list", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page([]),
    });

    renderRoute("/admin/qr-cards");

    expect(
      await screen.findByText("No cards yet. Select employees and press Issue cards."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Employees" })).toBeInTheDocument();
  });

  it("says when no one matches the filters", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page([]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await screen.findByText(/No cards yet/);
    await user.selectOptions(screen.getByLabelText("Card state"), "expired");

    expect(await screen.findByText("No employee matches these filters.")).toBeInTheDocument();
  });

  it("shows an error with a way to try again", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": apiError(500, "INTERNAL_ERROR"),
    });

    renderRoute("/admin/qr-cards");

    expect(await screen.findByText(/Something went wrong on the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("roles", () => {
  it("shows the Super Admin no read-only note", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Sunil More");
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });

  it("tells a Plant Head the page is read-only and limited to their plant", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: PLANT_HEAD },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Sunil More");
    expect(screen.getByText("Read-only, your plant only.")).toBeInTheDocument();
    expect(
      screen.getByText(/Only the Super Admin issues, prints and revokes cards/),
    ).toBeInTheDocument();
  });

  it("tells a Corporate Head the page is read-only for all plants", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards");

    await screen.findByText("Sunil More");
    expect(screen.getByText("Read-only, all plants.")).toBeInTheDocument();
  });

  it("puts QR cards in the menu for every role", async () => {
    for (const body of [SUPER_ADMIN, CORPORATE_HEAD, PLANT_HEAD]) {
      mockApi({
        ...LAYOUT,
        "GET /auth/me": { body },
        "GET /qr-cards": page([]),
      });

      renderRoute("/admin/qr-cards");

      expect(await screen.findByRole("link", { name: "QR cards" })).toHaveAttribute(
        "href",
        "/admin/qr-cards",
      );
      document.body.innerHTML = "";
    }
  });
});

describe("daysBetween", () => {
  it("counts whole days between two dates, also across months and years", () => {
    expect(daysBetween("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysBetween("2026-10-20", "2026-10-28")).toBe(8);
    expect(daysBetween("2026-10-20", "2026-10-15")).toBe(-5);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2027-02-27", "2027-03-01")).toBe(2);
  });
});

describe("links with a filter", () => {
  it("starts with cards that end soon when the link says so (the dashboard link)", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards?state=expiring");

    await screen.findByText("Sunil More");
    expect(screen.getByLabelText("Card state")).toHaveValue("expiring");
    expect(
      calls.some(
        (call) => call.path.startsWith("/qr-cards?") && call.path.includes("state=expiring"),
      ),
    ).toBe(true);
  });

  it("ignores a state in the link that does not exist", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards": page(ROWS),
    });

    renderRoute("/admin/qr-cards?state=nonsense");

    await screen.findByText("Sunil More");
    expect(screen.getByLabelText("Card state")).toHaveValue("");
    expect(calls.some((call) => call.path.includes("nonsense"))).toBe(false);
  });
});
