// Bulk actions and test cards on the QR cards page: selecting people, what each button will do,
// what is sent to the server, and what the other roles never see.
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
import { card, cardRow } from "../../test/qr-card-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /contractors": { body: [] },
};

// Mahesh has no card, Sunil has a working one, Kiran's card is revoked.
const MAHESH = cardRow({ id: "e-3", code: "T-2043", name: "Mahesh Kadam" }, null);
const SUNIL = cardRow(
  { id: "e-1", code: "T-2041", name: "Sunil More" },
  { id: "c-1", serial: "C000123" },
);
const KIRAN = cardRow(
  { id: "e-5", code: "T-2047", name: "Kiran Shelar" },
  { id: "c-5", serial: "C000067", state: "revoked", revoked_at: "2026-10-12T06:00:00Z" },
);

function answers(extra: Record<string, unknown> = {}, rows = [MAHESH, SUNIL, KIRAN]) {
  return {
    ...LAYOUT,
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /qr-cards": page(rows),
    "GET /qr-test-cards": { body: [] },
    ...extra,
  } as Parameters<typeof mockApi>[0];
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

async function selectPeople(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) {
    await user.click(await screen.findByLabelText(`Select ${name}`));
  }
}

describe("selecting people", () => {
  it("shows the bulk bar with what each button will do with this selection", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam", "Sunil More", "Kiran Shelar");

    expect(screen.getByText("What each button will do with these 3 people")).toBeInTheDocument();
    // Mahesh and Kiran can get a card, Sunil already has one
    expect(screen.getByText(/2 get a new card, 1 are skipped/)).toBeInTheDocument();
    expect(screen.getByText("1 of 3 have a card to print.")).toBeInTheDocument();
    expect(screen.getByText("1 cards that are not revoked yet.")).toBeInTheDocument();
  });

  it("selects and clears everyone on the page", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await user.click(await screen.findByLabelText("Select everyone on this page"));
    expect(screen.getByText("What each button will do with these 3 people")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the selection" }));

    expect(screen.queryByText(/What each button will do/)).not.toBeInTheDocument();
  });

  it("disables a button that would do nothing", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Kiran Shelar"); // revoked card: nothing to print or revoke

    expect(screen.getByRole("button", { name: "Issue cards" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Print cards (A4)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke cards" })).toBeDisabled();
  });

  it.each([
    ["Plant Head", PLANT_HEAD],
    ["Corporate Head", CORPORATE_HEAD],
  ])("gives a %s no checkboxes, no bulk bar and no Test cards tab", async (_name, me) => {
    mockApi(answers({ "GET /auth/me": { body: me } }));

    renderRoute("/admin/qr-cards");

    await screen.findByText("Sunil More");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Test cards/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue cards" })).not.toBeInTheDocument();
  });
});

describe("issue cards in bulk", () => {
  it("says what happens, sends all selected people and shows who was skipped", async () => {
    const calls = mockApi(
      answers({
        "POST /qr-cards/bulk": {
          body: {
            done: 2,
            skipped: [{ code: "QR_CARD_EXISTS", employee_code: "T-2041", card_serial: "C000123" }],
            card_ids: ["c-new-1", "c-new-2"],
          },
        },
        "POST /qr-cards/print": { body: {} },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam", "Sunil More", "Kiran Shelar");
    await user.click(screen.getByRole("button", { name: "Issue cards" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Issue cards to 3 people")).toBeInTheDocument();
    expect(within(dialog).getByText("Skipped: already has card C000123")).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Issue 2 cards" });
    expect(submit).toBeDisabled(); // a reason is needed
    await user.type(within(dialog).getByLabelText("Reason"), "New batch of workers");
    await user.click(submit);

    expect(await screen.findByText("2 cards issued")).toBeInTheDocument();
    expect(
      screen.getByText("1 person was skipped. Nothing was changed for them."),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/qr-cards/bulk")?.body).toEqual({
      action: "issue",
      employee_ids: ["e-3", "e-1", "e-5"],
      reason: "New batch of workers",
    });
  });

  it("prints exactly the new cards from the result", async () => {
    const calls = mockApi(
      answers({
        "POST /qr-cards/bulk": {
          body: { done: 2, skipped: [], card_ids: ["c-new-1", "c-new-2"] },
        },
        "POST /qr-cards/print": { body: {} },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam", "Kiran Shelar");
    await user.click(screen.getByRole("button", { name: "Issue cards" }));
    await user.type(await screen.findByLabelText("Reason"), "New batch");
    await user.click(screen.getByRole("button", { name: "Issue 2 cards" }));
    await user.click(await screen.findByRole("button", { name: "Print the 2 new cards (A4)" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-cards/print")?.body).toEqual({
        card_ids: ["c-new-1", "c-new-2"],
        layout: "a4_sheet",
      }),
    );
  });

  it("offers printing in parts when more than 200 cards were made", async () => {
    const many = Array.from({ length: 314 }, (_, index) => `c-${index}`);
    mockApi(
      answers({
        "POST /qr-cards/bulk": { body: { done: 314, skipped: [], card_ids: many } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam");
    await user.click(screen.getByRole("button", { name: "Issue cards" }));
    await user.type(await screen.findByLabelText("Reason"), "Big import");
    await user.click(screen.getByRole("button", { name: "Issue 1 card" }));

    expect(
      await screen.findByRole("button", { name: "Print cards 1–200 (A4)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print cards 201–314 (A4)" })).toBeInTheDocument();
  });

  it("tells a refusal from the server in words", async () => {
    mockApi(answers({ "POST /qr-cards/bulk": apiError(503, "QR_SIGNING_NOT_CONFIGURED") }));
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam");
    await user.click(screen.getByRole("button", { name: "Issue cards" }));
    await user.type(await screen.findByLabelText("Reason"), "New worker");
    await user.click(screen.getByRole("button", { name: "Issue 1 card" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeInTheDocument();
  });
});

describe("revoke cards in bulk", () => {
  it("revokes only cards that are not revoked, with the chosen kind and reason", async () => {
    const calls = mockApi(
      answers({ "POST /qr-cards/bulk": { body: { done: 1, skipped: [], card_ids: [] } } }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam", "Sunil More", "Kiran Shelar");
    await user.click(screen.getByRole("button", { name: "Revoke cards" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("heading", { name: "Revoke 1 card" })).toBeInTheDocument();
    expect(within(dialog).getByText("Skipped: has no card")).toBeInTheDocument();
    expect(within(dialog).getByText("Skipped: already revoked")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Damaged"));
    await user.type(within(dialog).getByLabelText("Reason"), "Batch ended");
    await user.click(within(dialog).getByRole("button", { name: "Revoke 1 card" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-cards/bulk")?.body).toEqual({
        action: "revoke",
        card_ids: ["c-1"],
        kind: "damaged",
        reason: "Batch ended",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/What each button will do/)).not.toBeInTheDocument(); // selection cleared
  });
});

describe("print cards", () => {
  it("prints the chosen layout in a new tab and clears the selection", async () => {
    const calls = mockApi(answers({ "POST /qr-cards/print": { body: {} } }));
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Mahesh Kadam", "Sunil More");
    await user.click(screen.getByRole("button", { name: "Print cards (A4)" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("heading", { name: "Print 1 card" })).toBeInTheDocument();
    expect(within(dialog).getByText(/1 selected person is left out/)).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText(/One card per page/));
    await user.click(within(dialog).getByRole("button", { name: "Print 1 card" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-cards/print")?.body).toEqual({
        card_ids: ["c-1"],
        layout: "single_cards",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/What each button will do/)).not.toBeInTheDocument();
  });

  it("refuses more than 200 cards and tells how to print in parts", async () => {
    const rows = Array.from({ length: 201 }, (_, index) =>
      cardRow(
        { id: `e-${index}`, code: `T-${index}`, name: `Worker ${index}` },
        { id: `c-${index}` },
      ),
    );
    mockApi(answers({}, rows));
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await user.click(await screen.findByLabelText("Select everyone on this page"));
    await user.click(screen.getByRole("button", { name: "Print cards (A4)" }));

    expect(await screen.findByText("Too many cards to print")).toBeInTheDocument();
    expect(screen.getByText("You selected 201 cards.")).toBeInTheDocument();
    expect(screen.getByText(/Print at most 200 cards at a time/)).toBeInTheDocument();
  });

  it("shows the server's refusal with the revoked serials when a card was revoked meanwhile", async () => {
    mockApi(
      answers({
        "POST /qr-cards/print": apiError(409, "QR_CARD_REVOKED", { serials: ["C000123"] }),
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await selectPeople(user, "Sunil More");
    await user.click(screen.getByRole("button", { name: "Print cards (A4)" }));
    await user.click(await screen.findByRole("button", { name: "Print 1 card" }));

    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("C000123");
    // the dialog stays open so nothing is lost
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("test cards tab", () => {
  const TEST_CARD = card({
    id: "t-1",
    kind: "test",
    serial: "T000007",
    label: "Gate test K134",
    printed_plant: null,
    last_used_at: "2026-10-20T01:30:00Z",
  });

  async function openTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: /Test cards/ }));
  }

  it("lists the test cards with their last use", async () => {
    mockApi(answers({ "GET /qr-test-cards": { body: [TEST_CARD] } }));
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await openTab(user);

    const row = (await screen.findByText("T000007")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Gate test K134")).toBeInTheDocument();
    expect(within(row).getByText("20/10/2026 07:00")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await openTab(user);

    expect(await screen.findByText(/No test cards yet/)).toBeInTheDocument();
  });

  it("creates a test card with a label", async () => {
    const calls = mockApi(
      answers({
        "POST /qr-test-cards": { status: 201, body: { ...TEST_CARD, serial: "T000008" } },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await openTab(user);
    await user.click(await screen.findByRole("button", { name: "New test card" }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Create test card" });
    expect(create).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Label"), "Gate test X280");
    await user.click(create);

    await waitFor(() =>
      expect(
        calls.find((call) => call.path === "/qr-test-cards" && call.method === "POST")?.body,
      ).toEqual({
        label: "Gate test X280",
      }),
    );
  });

  it("revokes a test card with a reason and prints one", async () => {
    const calls = mockApi(
      answers({
        "GET /qr-test-cards": { body: [TEST_CARD] },
        "POST /qr-test-cards/t-1/revoke": { body: { ...TEST_CARD, state: "revoked" } },
        "POST /qr-cards/t-1/card.pdf": { body: {} },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/qr-cards");
    await openTab(user);
    const row = (await screen.findByText("T000007")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Print" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/qr-cards/t-1/card.pdf")).toBe(true),
    );

    await user.click(within(row).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Lost at the gate");
    await user.click(within(dialog).getByRole("button", { name: "Revoke card" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-test-cards/t-1/revoke")?.body).toEqual({
        reason: "Lost at the gate",
      }),
    );
  });
});
