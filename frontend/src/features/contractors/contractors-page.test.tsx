// Contractors: the company-wide list, adding one, and the refusal to switch off an agency that
// still has active workers. Other roles only read.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
};
const SHREE = {
  id: "ct-1",
  name: "Shree Manpower",
  contact_name: "Mr. Joshi",
  contact_phone: "98 1234 5678",
  is_active: true,
  active_workers: 120,
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("contractors", () => {
  it("lists agencies with workers and totals", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /contractors": { body: [SHREE] },
    });

    renderRoute("/admin/contractors");

    const row = (await screen.findByText("Shree Manpower")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Mr. Joshi")).toBeInTheDocument();
    expect(within(row).getByText("120")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("adds an agency", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /contractors": { body: [] },
      "POST /contractors": { status: 201, body: SHREE },
    });
    const user = userEvent.setup();

    renderRoute("/admin/contractors");
    expect(await screen.findByText("No contractors yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add contractor" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Agency"), "Shree Manpower");
    await user.type(within(dialog).getByLabelText("Office phone"), "98 1234 5678");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(
        calls.find((call) => call.method === "POST" && call.path === "/contractors")?.body,
      ).toEqual({
        name: "Shree Manpower",
        contact_name: null,
        contact_phone: "98 1234 5678",
      }),
    );
  });

  it("refuses letters in the phone number before sending", async () => {
    mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN }, "GET /contractors": { body: [] } });
    const user = userEvent.setup();

    renderRoute("/admin/contractors");
    await user.click(await screen.findByRole("button", { name: "Add contractor" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Agency"), "X");
    await user.type(within(dialog).getByLabelText("Office phone"), "call me");

    expect(within(dialog).getByText("Use digits, spaces, + and - only.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says why an agency with active workers cannot be switched off", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /contractors": { body: [SHREE] },
      "POST /contractors/ct-1/deactivate": apiError(409, "CONTRACTOR_IN_USE"),
    });
    const user = userEvent.setup();

    renderRoute("/admin/contractors");
    await user.click(await screen.findByRole("button", { name: "Switch off" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Contract ended");
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }));

    expect(await within(dialog).findByText(/still has active workers/)).toBeInTheDocument();
  });

  it("is read-only for a Plant Head", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: PLANT_HEAD },
      "GET /contractors": { body: [SHREE] },
    });

    renderRoute("/admin/contractors");

    await screen.findByText("Shree Manpower");
    expect(screen.queryByRole("button", { name: "Add contractor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch off" })).not.toBeInTheDocument();
  });
});
