// Audit log: the table, the side panel with before/after, and the role-based menu.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleNavItems } from "../../app/layouts/admin-layout";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const ENTRY = {
  id: "a-1",
  at: "2026-10-13T08:30:00Z",
  actor_type: "user",
  actor_id: "u-1",
  actor_name: "Tushar Gawande",
  action: "settings.update",
  entity_type: "setting",
  entity_id: null,
  plant_id: null,
  before: { value: 50 },
  after: { value: 30 },
  reason: "Gate phones are accurate",
  ip: "203.0.113.7",
  change_request_id: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audit log", () => {
  it("shows the time in IST and opens a before/after panel on click", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /audit": { body: { items: [ENTRY], page: 1, page_size: 50, total: 1 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/audit");
    await user.click(await screen.findByRole("button", { name: "13/10/2026, 14:00" }));

    const panel = screen.getByRole("complementary", { name: "Entry details" });
    expect(within(panel).getByText(/− Before/)).toBeInTheDocument();
    expect(within(panel).getByText(/\+ After/)).toBeInTheDocument();
    expect(within(panel).getByText("Gate phones are accurate")).toBeInTheDocument();
  });

  it("says so when no entry matches", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /audit": { body: { items: [], page: 1, page_size: 50, total: 0 } },
    });

    renderRoute("/admin/audit");

    expect(await screen.findByText("No entries match these filters.")).toBeInTheDocument();
  });
});

describe("menu by role", () => {
  it("shows Users only to the Super Admin", () => {
    const labels = (role: "super_admin" | "corporate_head" | "plant_head") =>
      visibleNavItems(role).map((item) => item.labelKey);

    expect(labels("super_admin")).toContain("nav.users");
    expect(labels("corporate_head")).not.toContain("nav.users");
    expect(labels("plant_head")).toEqual([
      "nav.dashboard",
      "nav.plants",
      "nav.kiosks",
      "nav.settings",
      "nav.audit",
    ]);
  });
});
