// The Ctrl+K palette and the plant filter in the top bar.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_HEAD, PLANT_K134, PLANT_X280, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134, PLANT_X280], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /employees": page([]),
  "GET /contractors": { body: [] },
};

const RESULTS = {
  employees: [
    {
      id: "e-1",
      employee_code: "1001",
      full_name: "Ramesh Kulkarni",
      plant_code: "K134",
      status: "active",
    },
  ],
  plants: [{ id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" }],
  kiosks: [{ id: "k-1", name: "Main gate phone", plant_id: "p-1" }],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function openPalette() {
  await screen.findByRole("heading", { name: "Employees" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("dialog");
}

describe("command palette", () => {
  it("opens with Ctrl+K and lists the pages", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });

    renderRoute("/admin/employees");
    const dialog = await openPalette();

    expect(
      within(dialog).getByPlaceholderText("Search employees, plants, pages…"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Contractors")).toBeInTheDocument();
  });

  it("asks for 2 characters, then shows employees, plants and kiosks from the server", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: RESULTS },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    const input = within(dialog).getByPlaceholderText("Search employees, plants, pages…");
    await user.type(input, "r");
    expect(within(dialog).getByText(/Type at least 2 characters/)).toBeInTheDocument();
    await user.type(input, "a");

    expect(await within(dialog).findByText("Ramesh Kulkarni")).toBeInTheDocument();
    expect(within(dialog).getByText("Main gate phone")).toBeInTheDocument();
    expect(
      calls
        .filter((call) => call.path.startsWith("/search"))
        .every((call) => call.path.includes("q=ra")),
    ).toBe(true);
  });

  it("opens the chosen employee", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: RESULTS },
      "GET /employees/e-1": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "x", details: {} } },
      },
    });
    const user = userEvent.setup();

    const router = renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText("Search employees, plants, pages…"), "ram");
    await user.click(await within(dialog).findByText("Ramesh Kulkarni"));

    // Pages load lazily, so the address changes once the next page has loaded.
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/employees/e-1"));
  });

  it("says nothing was found, and shows a search error", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: { employees: [], plants: [], kiosks: [] } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.type(
      within(dialog).getByPlaceholderText("Search employees, plants, pages…"),
      "zzzz",
    );

    expect(await within(dialog).findByText(/Nothing found for “zzzz”/)).toBeInTheDocument();
  });

  it("shows an error when the search fails", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": apiError(500, "INTERNAL_ERROR"),
    });
    const user = userEvent.setup();

    renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.type(within(dialog).getByPlaceholderText("Search employees, plants, pages…"), "ram");

    expect(
      await within(dialog).findByText("The search did not work. Try again."),
    ).toBeInTheDocument();
  });
});

describe("plant filter", () => {
  it("is fixed to the own plant for a Plant Head", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: PLANT_HEAD } });

    renderRoute("/admin/employees");

    expect(await screen.findByText("K134 · Sheet Shapers (K-134)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Plant filter")).not.toBeInTheDocument();
  });

  it("starts at the remembered plant", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-2");
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });
    renderRoute("/admin/employees");
    // The list of plants arrives after the first render, so wait for the choice to show.
    await vi.waitFor(() => expect(screen.getByLabelText("Plant filter")).toHaveValue("p-2"));
  });

  it("ignores a remembered plant that no longer exists", async () => {
    localStorage.setItem("upasthiti.plantFilter", "p-gone");
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });

    renderRoute("/admin/employees");

    await vi.waitFor(() => expect(screen.getByLabelText("Plant filter")).toHaveValue(""));
  });
});

// The face commands (spec M3 §4.13): the Super Admin enrols; every role sees the two lists.
describe("face commands", () => {
  const FACE_RESULTS = {
    ...RESULTS,
    employees: [{ ...RESULTS.employees[0], face_state: "not_enrolled" }],
  };

  it("lets the Super Admin pick an employee to enrol, with the face badge, and opens the enrolment", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /search": { body: FACE_RESULTS },
      "GET /employees/e-1": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "x", details: {} } },
      },
    });
    const user = userEvent.setup();

    const router = renderRoute("/admin/employees");
    const dialog = await openPalette();
    await user.click(within(dialog).getByText("Enrol face…"));
    await user.type(within(dialog).getByPlaceholderText("Type an employee's code or name…"), "ram");
    expect(await within(dialog).findByText("Not enrolled")).toBeInTheDocument();
    await user.click(await within(dialog).findByText("Ramesh Kulkarni"));

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        "/admin/employees/e-1?face=enrol",
      ),
    );
  });

  it("gives every role the two lists, and only the Super Admin the enrol command", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: PLANT_HEAD },
    });

    renderRoute("/admin/employees");
    const dialog = await openPalette();

    expect(within(dialog).getByText("Employees not enrolled")).toBeInTheDocument();
    expect(within(dialog).getByText("Re-enrol suggested")).toBeInTheDocument();
    expect(within(dialog).queryByText("Enrol face…")).not.toBeInTheDocument();
  });
});
