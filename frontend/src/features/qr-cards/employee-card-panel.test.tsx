// The QR card panel on an employee's page and its dialogs: what each role and each situation
// shows, what the dialogs send to the server, and how errors are told.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultValidUntil } from "../../lib/dates";
import { todayIst } from "../../lib/format";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import {
  CORPORATE_HEAD,
  employee,
  PLANT_HEAD,
  PLANT_K134,
  PLANT_X280,
  page,
} from "../../test/people-fixtures";
import { card, inDays } from "../../test/qr-card-fixtures";
import { renderRoute } from "../../test/render";

const WORKER = employee({
  id: "e-1",
  full_name: "Sunil More",
  employee_code: "T-2041",
  type: "temporary",
  punch_method: "qr",
});

function answers(
  options: {
    me?: unknown;
    person?: Record<string, unknown>;
    cards?: ReturnType<typeof card>[];
  } = {},
) {
  const { me = SUPER_ADMIN, person = WORKER, cards = [] } = options;
  return {
    "GET /plants": page([PLANT_K134, PLANT_X280], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /contractors": { body: [] },
    "GET /settings": {
      body: {
        settings: [
          { key: "qr_card_default_validity_months", value: 6, default: 6, editable: false },
        ],
      },
    },
    "GET /auth/me": { body: me },
    "GET /employees/e-1": { body: { employee: person, plant_history: [], shift_history: [] } },
    "GET /employees/e-1/timeline": { body: [] },
    "GET /employees/e-1/qr-cards": { body: { cards } },
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a working card", () => {
  it("shows the card with its serial, dates, printing and the plant on it", async () => {
    mockApi(answers({ cards: [card({ print_count: 2 })] }));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText("C000123")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("K134 (matches)")).toBeInTheDocument();
    expect(screen.getByText(/2 times, last 10\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/in 170 days/)).toBeInTheDocument();
    expect(screen.getByText(/10\/10\/2026 11:00 by Tushar Gawande/)).toBeInTheDocument();
  });

  it("gives the Super Admin all four actions", async () => {
    mockApi(answers({ cards: [card()] }));

    renderRoute("/admin/employees/e-1");

    await screen.findByText("C000123");
    for (const name of ["Print card", "Change end date", "Issue new card", "Revoke"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("advises a reprint when the employee has moved to another plant", async () => {
    mockApi(
      answers({
        cards: [
          card({
            reprint_needed: true,
            printed_plant: { id: "p-2", name: "Sheet Shapers (X-280)", code: "X280" },
          }),
        ],
      }),
    );

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText("Reprint advised.")).toBeInTheDocument();
    expect(
      screen.getByText(/This card shows X280, but the employee now works at K134/),
    ).toBeInTheDocument();
    expect(screen.getByText("X280 (the employee is now at K134)")).toBeInTheDocument();
  });

  it("tells the Super Admin to revoke a card of someone who now punches by face", async () => {
    mockApi(answers({ person: { ...WORKER, punch_method: "face" }, cards: [card()] }));

    renderRoute("/admin/employees/e-1");

    expect(
      await screen.findByText("Revoke this card: the kiosk rejects it now."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke card" })).toBeInTheDocument();
    // a card for a face employee cannot be replaced by a new one
    expect(screen.queryByRole("button", { name: "Issue new card" })).not.toBeInTheDocument();
  });
});

describe("no working card", () => {
  it("offers to issue a card to a QR employee", async () => {
    mockApi(answers());

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText("No working card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue card" })).toBeInTheDocument();
  });

  it("explains that a face employee needs no card, and offers none", async () => {
    mockApi(answers({ person: { ...WORKER, punch_method: "face" } }));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText(/punches by face, so no QR card is needed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue card" })).not.toBeInTheDocument();
  });

  it("offers no card to an employee who has left", async () => {
    mockApi(answers({ person: { ...WORKER, status: "left", left_on: "2026-10-01" } }));

    renderRoute("/admin/employees/e-1");

    expect(
      await screen.findByText("This employee has left, so no card can be issued."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue card" })).not.toBeInTheDocument();
  });

  it("lists earlier cards in the history, with who revoked them and why", async () => {
    const revoked = card({
      id: "card-0",
      serial: "C000067",
      state: "revoked",
      revoked_at: "2026-10-12T06:00:00Z",
      revoked_by: "Tushar Gawande",
      revoke_kind: "lost",
      revoke_reason: "Fell in the canal",
    });
    mockApi(answers({ cards: [revoked] }));
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByText("Card history"));

    expect(screen.getByText("C000067")).toBeInTheDocument();
    expect(screen.getByText(/Revoked 12\/10\/2026 by Tushar Gawande: Lost/)).toBeInTheDocument();
    expect(screen.getByText(/Fell in the canal/)).toBeInTheDocument();
  });
});

describe("read-only roles", () => {
  it.each([
    ["Plant Head", PLANT_HEAD],
    ["Corporate Head", CORPORATE_HEAD],
  ])("shows the card to a %s without any button", async (_name, me) => {
    mockApi(answers({ me, cards: [card()] }));

    renderRoute("/admin/employees/e-1");

    expect(await screen.findByText("C000123")).toBeInTheDocument();
    for (const name of [
      "Print card",
      "Change end date",
      "Issue new card",
      "Revoke",
      "Issue card",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("issue dialog", () => {
  it("suggests today and the end of the default months, and sends them", async () => {
    const calls = mockApi({
      ...answers(),
      "POST /employees/e-1/qr-cards": {
        status: 201,
        body: { card: card({ serial: "C000456" }), replaced_card: null },
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Issue card" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Valid from")).toHaveValue(todayIst());
    expect(within(dialog).getByLabelText("Valid until")).toHaveValue(
      defaultValidUntil(todayIst(), 6),
    );
    expect(within(dialog).queryByText(/will stop working at once/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Issue card" }));

    expect(await screen.findByText("Card C000456 issued")).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      valid_from: todayIst(),
      valid_until: defaultValidUntil(todayIst(), 6),
    });
  });

  it("follows the start date for the default end date until the end date is typed", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Issue card" }));
    const dialog = await screen.findByRole("dialog");
    const start = inDays(10);
    fireEvent.change(within(dialog).getByLabelText("Valid from"), { target: { value: start } });

    expect(within(dialog).getByLabelText("Valid until")).toHaveValue(defaultValidUntil(start, 6));
    fireEvent.change(within(dialog).getByLabelText("Valid until"), {
      target: { value: inDays(40) },
    });
    fireEvent.change(within(dialog).getByLabelText("Valid from"), {
      target: { value: inDays(20) },
    });
    expect(within(dialog).getByLabelText("Valid until")).toHaveValue(inDays(40));
  });

  it("warns that the old card stops working when it is replaced", async () => {
    mockApi({
      ...answers({ cards: [card()] }),
      "POST /employees/e-1/qr-cards": {
        status: 201,
        body: {
          card: card({ id: "card-2", serial: "C000456" }),
          replaced_card: card({ state: "revoked" }),
        },
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Issue new card" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("The current card C000123 will stop working at once."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Replace card" })).toBeInTheDocument();
  });

  it("prints the new card in a new tab from the done screen", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    URL.createObjectURL = vi.fn(() => "blob:new-card");
    URL.revokeObjectURL = vi.fn();
    const calls = mockApi({
      ...answers(),
      "POST /employees/e-1/qr-cards": {
        status: 201,
        body: { card: card({ id: "card-2", serial: "C000456" }), replaced_card: null },
      },
      "GET /qr-cards/card-2/card.pdf": { body: {} },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Issue card" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue card" }),
    );
    await user.click(await screen.findByRole("button", { name: "Print now" }));

    await waitFor(() => expect(tab.location.href).toBe("blob:new-card"));
    expect(calls.some((call) => call.path === "/qr-cards/card-2/card.pdf")).toBe(true);
  });

  it("tells the server's refusal in words", async () => {
    mockApi({
      ...answers(),
      "POST /employees/e-1/qr-cards": apiError(409, "EMPLOYEE_NOT_QR"),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Issue card" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue card" }),
    );

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeInTheDocument();
  });
});

describe("revoke dialog", () => {
  it("needs a reason, then sends the kind and the reason", async () => {
    const calls = mockApi({
      ...answers({ cards: [card()] }),
      "POST /qr-cards/card-1/revoke": { body: card({ state: "revoked" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Revoke card" });

    expect(within(dialog).getByText(/stops working at every gate immediately/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByLabelText("Damaged"));
    await user.type(within(dialog).getByLabelText("Reason"), "Torn in half");
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(calls.find((call) => call.path === "/qr-cards/card-1/revoke")?.body).toEqual({
        kind: "damaged",
        reason: "Torn in half",
      }),
    );
  });

  it("offers only the four kinds an admin may choose", async () => {
    mockApi(answers({ cards: [card()] }));
    const user = userEvent.setup();

    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");

    const kinds = within(dialog)
      .getAllByRole("radio")
      .map((radio) => (radio as HTMLInputElement).value);
    expect(kinds).toEqual(["lost", "damaged", "left", "other"]);
  });
});

describe("change end date dialog", () => {
  async function openDialog(cards = [card()]) {
    const calls = mockApi({
      ...answers({ cards }),
      "PATCH /qr-cards/card-1": { body: card() },
    });
    const user = userEvent.setup();
    renderRoute("/admin/employees/e-1");
    await user.click(await screen.findByRole("button", { name: "Change end date" }));
    return { calls, user, dialog: await screen.findByRole("dialog") };
  }

  it("ends the card today with one button, and tells how to stop it at once", async () => {
    const { calls, user, dialog } = await openDialog();

    expect(within(dialog).getByText(/To stop it at once, revoke it/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "End today" }));
    expect(within(dialog).getByLabelText("New end date")).toHaveValue(todayIst());
    await user.type(within(dialog).getByLabelText("Reason"), "Contract ended early");
    await user.click(within(dialog).getByRole("button", { name: "Save end date" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
        valid_until: todayIst(),
        reason: "Contract ended early",
      }),
    );
  });

  it("extends from the current end date by six months", async () => {
    const { user, dialog } = await openDialog([card({ valid_until: "2027-08-31" })]);

    await user.click(within(dialog).getByRole("button", { name: "Extend by 6 months" }));

    expect(within(dialog).getByLabelText("New end date")).toHaveValue("2028-02-29");
  });

  it("will not save a date in the past", async () => {
    const { user, dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("New end date"), {
      target: { value: inDays(-1) },
    });
    await user.type(within(dialog).getByLabelText("Reason"), "Mistake");

    expect(within(dialog).getByRole("button", { name: "Save end date" })).toBeDisabled();
  });
});
