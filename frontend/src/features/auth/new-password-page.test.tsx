// The new-password screen: the redirect when not logged in, the rule checklist, the repeat check,
// saving, and a refused password.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fill(current: string, newer: string, repeat: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), newer);
  await user.type(screen.getByLabelText("Type it again"), repeat);
  return user;
}

describe("new password screen", () => {
  it("sends a person who is not logged in to the login screen", async () => {
    mockApi({ "GET /auth/me": apiError(401, "NOT_AUTHENTICATED") });
    const router = renderRoute("/admin/new-password");
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/login"));
  });

  it("explains the first login and keeps Save off until every rule passes", async () => {
    mockApi({ "GET /auth/me": { body: { ...SUPER_ADMIN, must_change_password: true } } });
    renderRoute("/admin/new-password");
    expect(await screen.findByText(/temporary password/)).toBeInTheDocument();

    const user = await fill("old-pass", "12345", "123");
    expect(screen.getByText("The two passwords are different.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save password" })).toBeDisabled();
    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "tushar");
    expect(screen.getByRole("button", { name: "Save password" })).toBeDisabled();
  });

  it("saves and opens the dashboard", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /auth/change-password": { status: 204 },
      "GET /health": { hang: true },
    });
    const router = renderRoute("/admin/new-password");
    expect(await screen.findByText(/Choose a new password for your account/)).toBeInTheDocument();
    const user = await fill("old-pass", "Correct-Horse-42", "Correct-Horse-42");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
    expect(calls.find((call) => call.path === "/auth/change-password")?.body).toEqual({
      current_password: "old-pass",
      new_password: "Correct-Horse-42",
    });
  });

  it("shows the server's reason when the password is refused", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /auth/change-password": apiError(401, "INVALID_CREDENTIALS"),
    });
    renderRoute("/admin/new-password");
    const user = await fill("wrong", "Correct-Horse-42", "Correct-Horse-42");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
