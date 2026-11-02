// The user menu: my sessions, change password and log out each take the person to the right place.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Tushar Gawande|TG/ }));
  return user;
}

const ANSWERS = {
  "GET /auth/me": { body: SUPER_ADMIN },
  "GET /health": { hang: true },
  "GET /auth/sessions": { body: [] },
};

describe("user menu", () => {
  it("opens my sessions", async () => {
    mockApi(ANSWERS);
    const router = renderRoute("/admin");
    const user = await openMenu();
    await user.click(await screen.findByRole("menuitem", { name: "My sessions" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/sessions"));
  });

  it("opens the change password screen", async () => {
    mockApi(ANSWERS);
    const router = renderRoute("/admin");
    const user = await openMenu();
    await user.click(await screen.findByRole("menuitem", { name: "Change password" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/new-password"));
  });

  it("logs out and returns to the login screen", async () => {
    const calls = mockApi({
      ...ANSWERS,
      "POST /auth/logout": { status: 204 },
    });
    const router = renderRoute("/admin");
    const user = await openMenu();
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/login"));
    expect(calls.some((call) => call.path === "/auth/logout")).toBe(true);
  });
});
