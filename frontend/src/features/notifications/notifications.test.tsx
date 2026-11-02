// The notification centre: the bell with its unread count and panel, the Notifications page
// (texts by kind, filters, mark read) and the own email alerts (hidden when the server has no
// email settings).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

function postsTo(calls: { method: string; path: string }[], path: string) {
  return calls.filter((call) => call.method === "POST" && call.path === path);
}

function item(changes: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    kind: "still_inside",
    severity: "urgent",
    plant: { id: "p-1", code: "K134", name: "Sheet Shapers (K-134)" },
    text_key: "notification.still_inside",
    params: { count: 2, plant: "K134", minutes: 60 },
    link: "/admin/muster?plant_id=p-1",
    created_at: new Date().toISOString(),
    resolved_at: null,
    read: false,
    ...changes,
  };
}

const OFFLINE = item({
  id: "n-2",
  kind: "device_offline",
  severity: "warning",
  text_key: "notification.device_offline",
  params: { plant: "TP1", device: "TP1 Gate" },
  link: "/admin/kiosks",
  read: true,
});

const NOT_CONFIGURED = {
  email_enabled: false,
  email_kinds: [],
  email_configured: false,
  has_email: true,
};

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134], 200),
    "GET /notifications/unread-count": { body: { unread: 4 } },
    "GET /notifications": page([item(), OFFLINE], 25),
    "GET /me/notification-preferences": { body: NOT_CONFIGURED },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the bell", () => {
  it("shows the unread count in its name and as a number", async () => {
    mockApi(base());

    renderRoute("/admin/notifications");

    const bell = await screen.findByRole("button", { name: "Notifications, 4 unread" });
    expect(within(bell).getByText("4")).toBeInTheDocument();
  });

  it("opens a panel with the newest alerts, marks one read when its link is used", async () => {
    const calls = mockApi(base({ "POST /notifications/n-1/read": { status: 204 } }));
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.click(await screen.findByRole("button", { name: "Notifications, 4 unread" }));
    const panel = await screen.findByRole("dialog");

    expect(
      await within(panel).findByText(
        "2 people are still inside K134, 60 minutes after the shift ended.",
      ),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole("link", { name: /Open the list/ }));

    await waitFor(() => expect(postsTo(calls, "/notifications/n-1/read")).toHaveLength(1));
  });

  it("marks everything read from the panel", async () => {
    const calls = mockApi(base({ "POST /notifications/read-all": { status: 204 } }));
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.click(await screen.findByRole("button", { name: "Notifications, 4 unread" }));
    const panel = await screen.findByRole("dialog");
    await user.click(await within(panel).findByRole("button", { name: "Mark all as read" }));

    await waitFor(() => expect(postsTo(calls, "/notifications/read-all")).toHaveLength(1));
  });

  it("says when there is nothing, and when it cannot load", async () => {
    mockApi(
      base({
        "GET /notifications/unread-count": { body: { unread: 0 } },
        "GET /notifications": page([], 10),
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.click(await screen.findByRole("button", { name: "Notifications, none unread" }));

    expect(
      await within(await screen.findByRole("dialog")).findByText("You are all caught up"),
    ).toBeInTheDocument();
  });

  it("offers Try again when the panel cannot load", async () => {
    mockApi(base({ "GET /notifications": apiError(500, "INTERNAL") }));
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.click(await screen.findByRole("button", { name: "Notifications, 4 unread" }));

    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Notifications could not be loaded",
      ),
    ).toBeInTheDocument();
  });
});

describe("the notifications page", () => {
  it("writes each alert from its kind and values, with the urgent and unread words", async () => {
    mockApi(base());

    renderRoute("/admin/notifications");

    expect(
      await screen.findByText("2 people are still inside K134, 60 minutes after the shift ended."),
    ).toBeInTheDocument();
    expect(screen.getByText("Urgent · Still inside")).toBeInTheDocument();
    expect(screen.getAllByText("Unread").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Attendance device 'TP1 Gate' at TP1 is offline. Check its power and internet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open attendance devices/ })).toHaveAttribute(
      "href",
      "/admin/kiosks",
    );
  });

  it("writes a decided correction by its result, with dates as DD/MM/YYYY", async () => {
    mockApi(
      base({
        "GET /notifications": page(
          [
            item({
              id: "n-3",
              kind: "correction_decided",
              severity: "info",
              text_key: "notification.correction_decided",
              params: { date: "2026-10-27", result: "approved", reason: null },
              link: "/admin/corrections",
            }),
          ],
          25,
        ),
      }),
    );

    renderRoute("/admin/notifications");

    expect(
      await screen.findByText("Your correction for 27/10/2026 was approved."),
    ).toBeInTheDocument();
  });

  it("asks the server for one kind and for unread only", async () => {
    const calls = mockApi(base());
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await screen.findByText("Urgent · Still inside");
    await user.selectOptions(screen.getByLabelText("Kind of alert"), "device_offline");
    await user.click(screen.getByRole("button", { name: /^Unread/ }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path.startsWith("/notifications?") &&
            call.path.includes("kind=device_offline") &&
            call.path.includes("unread=true"),
        ),
      ).toBe(true),
    );
  });

  it("shows the empty state of a filter with Clear filters", async () => {
    mockApi(base({ "GET /notifications": page([], 25) }));
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.selectOptions(await screen.findByLabelText("Kind of alert"), "device_offline");

    expect(await screen.findByText("No notifications match these filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("says that email is not set up and hides the switches", async () => {
    mockApi(base());

    renderRoute("/admin/notifications");

    expect(await screen.findByText("Email is not set up on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("saves the own email alerts when email is set up", async () => {
    const calls = mockApi(
      base({
        "GET /me/notification-preferences": {
          body: { ...NOT_CONFIGURED, email_configured: true },
        },
        "PUT /me/notification-preferences": (call: { body: unknown }) => ({
          body: { ...(call.body as object), email_configured: true, has_email: true },
        }),
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/notifications");
    await user.click(await screen.findByRole("switch", { name: "Send me alerts by email" }));
    await user.click(screen.getByRole("switch", { name: "Device offline" }));
    await user.click(screen.getByRole("button", { name: "Save my email alerts" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        email_enabled: true,
        email_kinds: ["device_offline"],
      }),
    );
  });
});
