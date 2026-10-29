// More of the devices page and the drawer (M4 spec §4.7; AC-19, AC-22, AC-23, AC-37, AC-38,
// AC-41, AC-44): the state filter in the address, the 30-second refresh, the facts the drawer
// shows for each state of a battery, camera and storage, and the offline banner coming back.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const PLANT = {
  id: "p-1",
  name: "Sheet Shapers K134",
  code: "K134",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  kiosks: 1,
  employees: 0,
};

function device(changes: Record<string, unknown> = {}) {
  return {
    id: "k-1",
    plant_id: "p-1",
    name: "Main gate phone",
    status: "active",
    registered_at: "2026-10-20T03:00:00Z",
    registered_accuracy_m: "18.0",
    last_seen_at: "2026-10-28T08:00:00Z",
    app_version: "abc123",
    revoked_at: null,
    revoke_reason: null,
    sound_muted: false,
    last_self_test_at: null,
    state: "online",
    last_contact_at: "2026-10-28T08:00:00Z",
    last_punch_at: "2026-10-28T07:02:00Z",
    last_sync_at: null,
    queue: { count: 0, bytes: 0, oldest_punch_at: null },
    location: {
      state: "good",
      accuracy_m: 12,
      at: "2026-10-28T08:00:00Z",
      inside: "inside",
      lat: null,
      lon: null,
    },
    storage: { persisted: true, quota_mb: 5000, usage_mb: 40, offline_ready: true },
    battery: { level: 0.82, charging: true },
    camera_ok: true,
    ...changes,
  };
}

const NO_ALERT = { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] };
const EMPTY_HEALTH = {
  days: [
    { date: "2026-10-28", online_minutes: 0, offline_minutes: 0, shift_minutes: 0, stretches: [] },
  ],
  latest: null,
};

function open(path: string, devices: unknown[], extra: Record<string, unknown> = {}) {
  const calls = mockApi({
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": { body: { items: [PLANT], page: 1, page_size: 200, total: 1 } },
    "GET /kiosks/status-summary": { body: NO_ALERT },
    "GET /kiosks": { body: devices },
    "GET /kiosks/k-1/health": { body: EMPTY_HEALTH },
    ...extra,
  });
  renderRoute(path);
  return calls;
}

function lastQuery(calls: RecordedCall[], path: string): URLSearchParams {
  const call = [...calls].reverse().find((entry) => entry.path.split("?")[0] === path);
  return new URLSearchParams(call?.path.split("?")[1] ?? "");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("the devices page filter and refresh", () => {
  it("asks for the state in the address and changes it from the filter", async () => {
    const calls = open("/admin/kiosks?state=offline", [device({ state: "offline" })]);

    await screen.findByRole("button", { name: "Main gate phone" });

    expect(lastQuery(calls, "/kiosks").get("state")).toBe("offline");
    const filter = screen.getByRole("combobox", { name: /state/i });
    await userEvent.selectOptions(filter, "needs_location");
    await waitFor(() => expect(lastQuery(calls, "/kiosks").get("state")).toBe("needs_location"));
  });

  it("refreshes by itself every 30 seconds, and weak location with waiting punches shows both", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer = [device()];
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": { body: { items: [PLANT], page: 1, page_size: 200, total: 1 } },
      "GET /kiosks/status-summary": { body: NO_ALERT },
      "GET /kiosks": () => ({ body: answer }),
    });
    renderRoute("/admin/kiosks");
    const row = async () =>
      (await screen.findByRole("button", { name: "Main gate phone" })).closest("tr") as HTMLElement;
    expect(within(await row()).getByText("Online")).toBeInTheDocument();

    answer = [
      device({
        state: "needs_location",
        queue: { count: 12, bytes: 9, oldest_punch_at: "2026-10-28T02:35:00Z" },
      }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    await waitFor(async () => {
      const refreshed = await row();
      expect(within(refreshed).getByText("Needs location")).toBeInTheDocument();
      expect(within(refreshed).getByText("12")).toBeInTheDocument();
    });
  });
});

describe("the rows of the devices table", () => {
  it("shows why a device was switched off and offers no actions for it", async () => {
    open("/admin/kiosks", [
      device({
        status: "revoked",
        state: "revoked",
        revoke_reason: "Phone lost",
        last_punch_at: null,
        last_seen_at: null,
        registered_accuracy_m: null,
      }),
    ]);

    const row = (await screen.findByRole("button", { name: "Main gate phone" })).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("Switched off")).toBeInTheDocument();
    expect(within(row).getByText("Phone lost")).toBeInTheDocument();
    expect(within(row).getByText("Never")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("asks for a new pairing code for a device that is waiting for pairing", async () => {
    const calls = open(
      "/admin/kiosks",
      [device({ status: "pending", state: "pending", last_seen_at: null })],
      {
        "POST /kiosks/k-1/pairing-code": {
          status: 201,
          body: {
            kiosk: device({ status: "pending", state: "pending" }),
            pairing_code: "123456",
            expires_at: "2026-10-28T09:00:00Z",
          },
        },
      },
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New code" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "/kiosks/k-1/pairing-code")).toBe(true),
    );
  });
});

describe("renaming and switching off a device", () => {
  it("renames a device", async () => {
    const calls = open("/admin/kiosks", [device()], {
      "PATCH /kiosks/k-1": { body: device({ name: "Gate 1" }) },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Rename Main gate phone" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename device" });
    const field = within(dialog).getByLabelText("Device name");
    await user.clear(field);
    await user.type(field, "  Gate 1  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.body).toEqual({ name: "Gate 1" });
    });
  });

  it("shows the server's answer when renaming fails, and cancels", async () => {
    open("/admin/kiosks", [device()], { "PATCH /kiosks/k-1": apiError(404, "NOT_FOUND") });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Rename Main gate phone" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename device" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Not found.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("switches a device off with a reason", async () => {
    const calls = open("/admin/kiosks", [device()], {
      "POST /kiosks/k-1/revoke": { body: device({ status: "revoked", state: "revoked" }) },
    });
    const user = userEvent.setup();
    const row = (await screen.findByText("Main gate phone")).closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Phone lost");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      const post = calls.find((call) => call.path === "/kiosks/k-1/revoke");
      expect(post?.body).toEqual({ reason: "Phone lost" });
    });
  });

  it("shows the server's answer when switching off fails", async () => {
    open("/admin/kiosks", [device()], {
      "POST /kiosks/k-1/revoke": apiError(403, "FORBIDDEN"),
    });
    const user = userEvent.setup();
    const row = (await screen.findByText("Main gate phone")).closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Phone lost");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(await within(dialog).findByText("You are not allowed to do this.")).toBeInTheDocument();
  });
});

describe("the drawer facts", () => {
  async function drawerOf(changes: Record<string, unknown>, health = EMPTY_HEALTH) {
    open("/admin/kiosks", [device(changes)], { "GET /kiosks/k-1/health": { body: health } });
    await userEvent.click(await screen.findByRole("button", { name: "Main gate phone" }));
    return screen.findByRole("dialog");
  }

  it("shows a battery that is not charging, a camera that does not work and no storage figure", async () => {
    const drawer = await drawerOf({
      battery: { level: 0.4, charging: false },
      camera_ok: false,
      storage: { persisted: false, quota_mb: null, usage_mb: null, offline_ready: null },
    });

    expect(within(drawer).getByText("40%")).toBeInTheDocument();
    expect(within(drawer).getByText("Not working")).toBeInTheDocument();
    expect(within(drawer).getAllByText("Not reported").length).toBeGreaterThan(0);
  });

  it("says offline saving is off when the device has too little storage", async () => {
    const drawer = await drawerOf({
      storage: { persisted: true, quota_mb: 200, usage_mb: 150, offline_ready: false },
    });

    expect(within(drawer).getByText(/Offline saving off/)).toBeInTheDocument();
  });

  it("shows the waiting punches with their time, a position outside the fence and 'No data'", async () => {
    const drawer = await drawerOf({
      state: "needs_location",
      queue: { count: 3, bytes: 7, oldest_punch_at: "2026-10-28T02:35:00Z" },
      location: {
        state: "outside",
        accuracy_m: 20,
        at: "2026-10-28T08:00:00Z",
        inside: "outside",
        lat: null,
        lon: null,
      },
      last_contact_at: null,
      last_punch_at: null,
    });

    expect(within(drawer).getByText(/^3 waiting since \d\d:\d\d$/)).toBeInTheDocument();
    expect(within(drawer).getByText("Outside the fence (±20 m)")).toBeInTheDocument();
    expect(within(drawer).getByText("Never")).toBeInTheDocument();
    expect(await within(drawer).findByText("No data")).toBeInTheDocument();
  });

  it("shows the waiting punches without a time when the device did not report one", async () => {
    const drawer = await drawerOf({
      queue: { count: 1, bytes: 7, oldest_punch_at: null },
    });

    expect(within(drawer).getByText("1 waiting since –")).toBeInTheDocument();
  });
});

describe("the offline banner", () => {
  it("comes back for a device that was online in between", async () => {
    const alert = {
      kiosk: { id: "k-2", name: "TP1 Gate" },
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers K134" },
      offline_since: "2026-10-28T02:42:00Z",
    };
    let summary = { ...NO_ALERT, offline: 1, alerts: [alert] };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": { body: { items: [PLANT], page: 1, page_size: 200, total: 1 } },
      "GET /kiosks/status-summary": () => ({ body: summary }),
      "GET /kiosks": { body: [] },
    });
    renderRoute("/admin/kiosks");
    expect(await screen.findByText(/“TP1 Gate” has been offline/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(/“TP1 Gate” has been offline/)).not.toBeInTheDocument();

    // The device is back for a minute: the choice to hide is forgotten ...
    summary = { ...NO_ALERT, alerts: [] };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(localStorage.getItem("upasthiti.hiddenOfflineAlerts")).toBe("[]"));
    // ... so its next outage shows the banner again.
    summary = { ...NO_ALERT, offline: 1, alerts: [alert] };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(await screen.findByText(/“TP1 Gate” has been offline/)).toBeInTheDocument();
  });
});
