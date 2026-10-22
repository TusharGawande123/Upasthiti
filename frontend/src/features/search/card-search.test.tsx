// The palette's card features: finding a person by card serial, the "Issue QR card…" and
// "Print QR cards…" commands (Super Admin only), and the employee picker.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import {
  CORPORATE_HEAD,
  employee,
  PLANT_HEAD,
  PLANT_K134,
  PLANT_X280,
  page,
} from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /qr-cards/expiring-count": { body: { count: 0, days: 14 } },
  "GET /employees": page([]),
  "GET /contractors": { body: [] },
  "GET /qr-cards": page([]),
  "GET /qr-test-cards": { body: [] },
};

const BY_SERIAL = {
  employees: [
    {
      id: "e-1",
      employee_code: "T-2041",
      full_name: "Sunil More",
      plant_code: "K134",
      status: "active",
      card_serial: "C000123",
    },
  ],
  plants: [],
  kiosks: [],
};

const SEARCH_PLACEHOLDER = "Search employees, plants, pages…";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function openPalette() {
  await screen.findByRole("heading", { name: "Employees" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("dialog");
}

describe("card serial in the palette", () => {
  it("shows the serial that matched next to the person", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: BY_SERIAL },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText(SEARCH_PLACEHOLDER), "C000123");

    const row = (await within(dialog).findByText("Sunil More")).closest(
      "[cmdk-item]",
    ) as HTMLElement;
    expect(within(row).getByText("C000123")).toBeInTheDocument();
    expect(within(row).getByText("T-2041")).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("q=C000123"))).toBe(true);
  });

  it("tells how to search by serial when the box is empty", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });

    renderRoute("/admin/employees");
    const dialog = await openPalette();

    expect(within(dialog).getByText(/Type a card serial like C000123/)).toBeInTheDocument();
  });
});

describe("palette commands", () => {
  it("offers the Super Admin the two card commands", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });

    renderRoute("/admin/employees");
    const dialog = await openPalette();

    expect(within(dialog).getByText("Issue QR card…")).toBeInTheDocument();
    expect(within(dialog).getByText("Print QR cards…")).toBeInTheDocument();
  });

  it.each([
    ["Plant Head", PLANT_HEAD],
    ["Corporate Head", CORPORATE_HEAD],
  ])("offers a %s no card commands", async (_name, me) => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: me } });

    renderRoute("/admin/employees");
    const dialog = await openPalette();

    expect(within(dialog).queryByText("Issue QR card…")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Print QR cards…")).not.toBeInTheDocument();
  });

  it("filters the commands by what is typed", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: BY_SERIAL },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText(SEARCH_PLACEHOLDER), "print");

    expect(within(dialog).getByText("Print QR cards…")).toBeInTheDocument();
    expect(within(dialog).queryByText("Issue QR card…")).not.toBeInTheDocument();
  });

  it("opens the cards not printed yet from 'Print QR cards…'", async () => {
    const calls = mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });
    const user = userEvent.setup();

    const router = renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.click(within(dialog).getByText("Print QR cards…"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/qr-cards"));
    expect(router.state.location.search).toBe("?printed=no");
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path.startsWith("/qr-cards?") && call.path.includes("printed=false"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByLabelText("Printed")).toHaveValue("no");
  });

  it("asks for an employee after 'Issue QR card…' and opens that employee's issue dialog", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: BY_SERIAL },
      "GET /settings": { body: { settings: [] } },
      "GET /employees/e-1": {
        body: {
          employee: employee({ id: "e-1", full_name: "Sunil More", punch_method: "qr" }),
          plant_history: [],
          shift_history: [],
        },
      },
      "GET /employees/e-1/timeline": { body: [] },
      "GET /employees/e-1/qr-cards": { body: { cards: [] } },
    });
    const user = userEvent.setup();

    const router = renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.click(within(dialog).getByText("Issue QR card…"));

    // the palette now asks for a person, and offers only people (no pages, no commands)
    const input = within(dialog).getByPlaceholderText("Type an employee's code or name…");
    expect(within(dialog).queryByText("Contractors")).not.toBeInTheDocument();
    await user.type(input, "su");
    await user.click(await within(dialog).findByText("Sunil More"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/employees/e-1"));
    const issue = await screen.findByRole("dialog");
    expect(within(issue).getByText("Issue a new QR card")).toBeInTheDocument();
    // the word is removed from the address once the dialog is open
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("does not open the issue dialog for someone who punches by face", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /employees/e-1": {
        body: {
          employee: employee({ id: "e-1", punch_method: "face" }),
          plant_history: [],
          shift_history: [],
        },
      },
      "GET /employees/e-1/timeline": { body: [] },
      "GET /employees/e-1/qr-cards": { body: { cards: [] } },
    });

    const router = renderRoute("/admin/employees/e-1?issue=card");

    expect(await screen.findByText(/punches by face, so no QR card is needed/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("goes back from the employee picker to the normal palette", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.click(within(dialog).getByText("Issue QR card…"));
    await user.click(within(dialog).getByRole("button", { name: "Back" }));

    expect(within(dialog).getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    expect(within(dialog).getByText("Contractors")).toBeInTheDocument();
  });
});
