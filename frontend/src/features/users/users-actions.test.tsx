// Users page, more cases: reset password (shown once, copied), force log-out, reactivate,
// the search box, a refused action, the empty list and a failed load with "Try again".
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function aUser(changes: Record<string, unknown> = {}) {
  return {
    id: "u-2",
    name: "Asha Rao",
    username: "asha.rao",
    email: null,
    role: "plant_head",
    plant_id: "p-1",
    is_active: true,
    must_change_password: false,
    last_login_at: "2026-10-12T05:00:00Z",
    created_at: "2026-10-12T00:00:00Z",
    ...changes,
  };
}

function page(items: unknown[]) {
  return { body: { items, page: 1, page_size: 50, total: items.length } };
}

const PLANTS = page([{ id: "p-1", name: "Sheet Shapers (K-134)", code: "K134", is_active: true }]);

async function confirmWithReason(reason: string) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Reason"), reason);
  return { user, dialog };
}

describe("users page actions", () => {
  it("shows the plant, resets a password and copies the new one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([aUser()]),
      "GET /plants": PLANTS,
      "POST /users/u-2/reset-password": {
        // Fake value for this test only. gitleaks:allow
        body: { ...aUser(), temporary_password: "Zq8nWm3LpTx5Vd" }, // gitleaks:allow
      },
    });
    const user = userEvent.setup();
    renderRoute("/admin/users");

    expect(await screen.findByText("K134")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset password of Asha Rao" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Forgot it");
    await user.click(within(dialog).getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Zq8nWm3LpTx5Vd")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("Zq8nWm3LpTx5Vd")).toBeNull());
  });

  it("logs a user out of every device", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([aUser()]),
      "GET /plants": PLANTS,
      "POST /users/u-2/force-logout": { body: aUser() },
    });
    renderRoute("/admin/users");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Log out Asha Rao on all devices" }),
    );
    const { dialog } = await confirmWithReason("Lost phone");
    await user.click(within(dialog).getByRole("button", { name: "Log out everywhere" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/users/u-2/force-logout")).toBe(true),
    );
  });

  it("switches an inactive user back on", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([aUser({ is_active: false })]),
      "GET /plants": PLANTS,
      "POST /users/u-2/reactivate": { body: aUser() },
    });
    renderRoute("/admin/users");
    const user = userEvent.setup();
    expect(await screen.findByText("Switched off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch on" }));
    const { dialog } = await confirmWithReason("Back from leave");
    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/users/u-2/reactivate")).toBe(true),
    );
  });

  it("shows the server's refusal inside the reason dialog and lets the person cancel", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([aUser()]),
      "GET /plants": PLANTS,
      "POST /users/u-2/deactivate": apiError(409, "LAST_SUPER_ADMIN"),
    });
    renderRoute("/admin/users");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Switch off" }));
    const { dialog } = await confirmWithReason("Test");
    await user.click(within(dialog).getByRole("button", { name: "Switch off" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("searches, and says so when nobody matches", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": page([]),
      "GET /plants": PLANTS,
    });
    renderRoute("/admin/users");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox"), "zzz");
    await waitFor(() => expect(calls.at(-1)?.path).toContain("q=zzz"));
    expect(await screen.findByText("No users match.")).toBeInTheDocument();
  });

  it("offers Try again when the list fails", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /users": apiError(500, "SERVER_ERROR"),
      "GET /plants": PLANTS,
    });
    renderRoute("/admin/users");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
