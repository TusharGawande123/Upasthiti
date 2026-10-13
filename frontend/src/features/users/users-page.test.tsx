// Users page: the table, the add-user flow with the one-time temporary password, and the
// reason that every change needs.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const ASHA = {
  id: "u-2",
  name: "Asha Rao",
  username: "asha.rao",
  email: "asha@example.com",
  role: "corporate_head",
  plant_id: null,
  is_active: true,
  must_change_password: true,
  last_login_at: null,
  created_at: "2026-10-12T00:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function page(items: unknown[]) {
  return { body: { items, page: 1, page_size: 50, total: items.length } };
}

describe("users page", () => {
  it("lists users with username, email under it, role and an icon+word status", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([ASHA]),
      "GET /plants": page([]),
    });

    renderRoute("/admin/users");

    const row = (await screen.findByText("Asha Rao")).closest("tr") as HTMLElement;
    expect(within(row).getByText("asha.rao")).toBeInTheDocument();
    expect(within(row).getByText("asha@example.com")).toBeInTheDocument();
    expect(within(row).getByText("Corporate Head")).toBeInTheDocument();
    expect(within(row).getByText("Temp password")).toBeInTheDocument();
    expect(within(row).getByText("Never")).toBeInTheDocument();
  });

  it("creates a user and shows the temporary password once", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([]),
      "GET /plants": page([]),
      "POST /users": {
        status: 201,
        // Fake value for this test only. gitleaks:allow
        body: { user: ASHA, temporary_password: "Xk7mRp2VqTn4Hd" }, // gitleaks:allow
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Full name"), "Asha Rao");
    await user.type(within(dialog).getByLabelText("Username"), "Asha.Rao");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await screen.findByText("Xk7mRp2VqTn4Hd")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    const sent = calls.find((call) => call.method === "POST" && call.path === "/users");
    expect(sent?.body).toMatchObject({
      name: "Asha Rao",
      username: "asha.rao",
      role: "corporate_head",
    });
  });

  it("asks for a plant when the role is Plant Head", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([]),
      "GET /plants": page([
        { id: "p-1", name: "Sheet Shapers (K-134)", code: "K134", is_active: true },
      ]),
    });
    const user = userEvent.setup();

    renderRoute("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Full name"), "K Head");
    await user.type(within(dialog).getByLabelText("Username"), "k.head");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "plant_head");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText("Choose a plant for a Plant Head.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("will not switch a user off without a reason", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([ASHA]),
      "GET /plants": page([]),
      "POST /users/u-2/deactivate": { body: { ...ASHA, is_active: false } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/users");
    await user.click(await screen.findByRole("button", { name: "Switch off" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Switch off" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Reason"), "Left the company");
    await user.click(confirm);

    expect(calls.find((call) => call.path === "/users/u-2/deactivate")?.body).toEqual({
      reason: "Left the company",
    });
  });
});
