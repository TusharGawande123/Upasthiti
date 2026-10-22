// The slide-out menu for phones and tablets: it opens from the button, lists the same pages as the
// left menu for the user's role, and closes after a page is chosen.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone menu", () => {
  it("opens from the menu button, shows the pages and closes after choosing one", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /approvals/pending-count": { body: { count: 0 } },
      "GET /qr-cards/expiring-count": { body: { count: 0 } },
    });
    const user = userEvent.setup();

    const router = renderRoute("/admin");
    await user.click(await screen.findByRole("button", { name: "Open the menu" }));

    const dialog = await screen.findByRole("dialog", { name: "Main menu" });
    const menu = within(dialog);
    expect(menu.getByRole("link", { name: "QR cards" })).toBeInTheDocument();
    expect(menu.getByRole("link", { name: "Punch log" })).toBeInTheDocument();

    await user.click(menu.getByRole("link", { name: "Plants" }));

    expect(screen.queryByRole("dialog", { name: "Main menu" })).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/plants"));
  });

  it("shows only the pages a Corporate Head may use", async () => {
    mockApi({ "GET /auth/me": { body: CORPORATE_HEAD } });
    const user = userEvent.setup();

    renderRoute("/admin");
    await user.click(await screen.findByRole("button", { name: "Open the menu" }));

    const menu = within(await screen.findByRole("dialog", { name: "Main menu" }));
    expect(menu.getByRole("link", { name: "My requests" })).toBeInTheDocument();
    expect(menu.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(menu.queryByRole("link", { name: "Approvals" })).not.toBeInTheDocument();
  });
});
