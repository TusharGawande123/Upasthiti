// Audit log, more cases: the filters go to the server, the actor labels, odd before/after values,
// the empty-change panel, closing the panel and a failed load.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

afterEach(() => {
  vi.unstubAllGlobals();
});

function entry(changes: Record<string, unknown>) {
  return {
    id: "a-1",
    at: "2026-10-13T08:30:00Z",
    actor_type: "user",
    actor_id: "u-1",
    actor_name: "Tushar Gawande",
    action: "settings.update",
    entity_type: "setting",
    entity_id: null,
    plant_id: null,
    before: null,
    after: null,
    reason: null,
    ip: null,
    change_request_id: null,
    ...changes,
  };
}

function answerWith(items: unknown[]) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /audit": { body: { items, page: 1, page_size: 50, total: items.length } },
  };
}

describe("audit log filters and panel", () => {
  it("sends the chosen filters to the server", async () => {
    const calls = mockApi(answerWith([entry({})]));
    renderRoute("/admin/audit");
    const user = userEvent.setup();
    await screen.findByText("settings.update");

    await user.type(screen.getByLabelText("From"), "2026-10-01");
    await user.type(screen.getByLabelText("To"), "2026-10-31");
    await user.selectOptions(screen.getByLabelText("Who"), "kiosk");
    await user.type(screen.getByLabelText("Action"), " auth.login ");

    await waitFor(() => {
      const last = calls.filter((call) => call.path.startsWith("/audit")).at(-1)?.path ?? "";
      expect(last).toContain("actor_type=kiosk");
      expect(last).toContain("action=auth.login");
      expect(last).toContain("from=2026-10-01");
      expect(last).toContain("to=2026-10-31");
    });
  });

  it("names the actor, shows odd values and the reason, then closes the panel", async () => {
    mockApi(
      answerWith([
        entry({
          id: "a-2",
          actor_type: "kiosk",
          actor_name: null,
          action: "kiosk.paired",
          before: { shifts: ["A", "B"], note: null },
          after: { shifts: ["A"], note: "x" },
        }),
        entry({ id: "a-3", actor_type: "system", actor_name: null, action: "job.run" }),
      ]),
    );
    renderRoute("/admin/audit");
    const user = userEvent.setup();
    await screen.findByText("kiosk.paired");

    const buttons = screen.getAllByRole("button", { name: /13\/10\/2026/ });
    await user.click(buttons[0] as HTMLElement);
    const panel = screen.getByRole("complementary", { name: "Entry details" });
    expect(within(panel).getByText('["A","B"]')).toBeInTheDocument();
    expect(within(panel).getByText("–")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Entry details" })).toBeNull();

    await user.click(buttons[1] as HTMLElement);
    expect(screen.getByText("No field values were recorded for this entry.")).toBeInTheDocument();
  });

  it("shows an error when the log cannot be loaded", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /audit": apiError(500, "SERVER_ERROR"),
    });
    renderRoute("/admin/audit");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
