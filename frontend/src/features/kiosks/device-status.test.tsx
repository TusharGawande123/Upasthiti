// The devices page, the offline badge and alert, and the drawer (M4 spec §4.7; AC-22, AC-37,
// AC-38, AC-41). The server decides states and alerts: these tests check that the screens show
// them with an icon AND a word, and hide what a role may not see.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
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

function plantsPage(items: unknown[]) {
  return { body: { items, page: 1, page_size: 200, total: items.length } };
}

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
      lat: 19.85,
      lon: 75.25,
    },
    storage: { persisted: true, quota_mb: 5000, usage_mb: 40, offline_ready: true },
    battery: { level: 0.82, charging: true },
    camera_ok: true,
    ...changes,
  };
}

const SUMMARY = {
  online: 1,
  offline: 1,
  needs_location: 0,
  sending: 0,
  alerts: [
    {
      kiosk: { id: "k-2", name: "TP1 Gate" },
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers K134" },
      offline_since: "2026-10-28T02:42:00Z",
    },
  ],
};

const HEALTH = {
  days: [
    {
      date: "2026-10-28",
      online_minutes: 1300,
      offline_minutes: 60,
      shift_minutes: 720,
      stretches: [
        { start: "2026-10-27T18:30:00Z", end: "2026-10-28T02:00:00Z", state: "online" },
        { start: "2026-10-28T02:00:00Z", end: "2026-10-28T03:00:00Z", state: "offline" },
      ],
    },
  ],
  latest: {
    battery: { level: 0.82, charging: true },
    camera_ok: true,
    storage: { persisted: true, quota_mb: 5000, usage_mb: 40, offline_ready: true },
    app_version: "abc123",
    at: "2026-10-28T08:00:00Z",
  },
};

function open(devices: unknown[], extra: Record<string, unknown> = {}) {
  mockApi({
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": plantsPage([PLANT]),
    "GET /kiosks/status-summary": { body: SUMMARY },
    "GET /kiosks": { body: devices },
    ...extra,
  });
  renderRoute("/admin/kiosks");
}

beforeEach(() => localStorage.clear());

describe("the devices page", () => {
  it("shows each state as an icon plus a word, with the waiting punches", async () => {
    open([
      device(),
      device({
        id: "k-2",
        name: "TP1 Gate",
        state: "offline",
        last_contact_at: "2026-10-28T02:42:00Z",
      }),
      device({ id: "k-3", name: "Gate C", state: "needs_location" }),
      device({
        id: "k-4",
        name: "Gate D",
        state: "sending",
        queue: { count: 12, bytes: 9, oldest_punch_at: "2026-10-28T02:35:00Z" },
      }),
    ]);

    await screen.findByRole("button", { name: "Main gate phone" });
    const row = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;
    expect(within(row("Main gate phone")).getByText("Online")).toBeInTheDocument();
    expect(within(row("TP1 Gate")).getByText(/^Offline since \d\d:\d\d$/)).toBeInTheDocument();
    expect(within(row("Gate C")).getByText("Needs location")).toBeInTheDocument();
    const sending = row("Gate D");
    expect(within(sending).getByText("Sending saved punches (12)")).toBeInTheDocument();
    expect(within(sending).getByText("12")).toBeInTheDocument();
  });

  it("opens a drawer with battery, camera, storage and the 7-day timeline", async () => {
    open([device()], { "GET /kiosks/k-1/health": { body: HEALTH } });

    await userEvent.click(await screen.findByRole("button", { name: "Main gate phone" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("82% (charging)")).toBeInTheDocument();
    expect(within(drawer).getByText("Working")).toBeInTheDocument();
    expect(within(drawer).getByText("40 MB used, 4960 MB free")).toBeInTheDocument();
    expect(within(drawer).getByText("Offline saving ready")).toBeInTheDocument();
    expect(within(drawer).getByText("Inside the fence (±12 m)")).toBeInTheDocument();
    expect(await within(drawer).findByText(/^Online \d+% of the time$/)).toBeInTheDocument();
    expect(
      within(drawer).getByRole("img", { name: /Online 1300 min, offline 60 min/ }),
    ).toBeInTheDocument();
  });

  it("says 'Not reported' for a battery the browser does not give", async () => {
    open([device({ battery: null })], {
      "GET /kiosks/k-1/health": {
        body: { ...HEALTH, latest: { ...HEALTH.latest, battery: null } },
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Main gate phone" }));

    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("Not reported")).toBeInTheDocument();
  });

  it("warns in the revoke dialog how many saved punches would be lost", async () => {
    open([device({ queue: { count: 12, bytes: 9, oldest_punch_at: null } })]);

    const row = (await screen.findByText("Main gate phone")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Revoke" }));

    expect(
      await screen.findByText(/12 punches are still waiting on this attendance device/),
    ).toBeInTheDocument();
  });
});

describe("the offline badge and alert", () => {
  it("shows the badge and an alert that can be hidden", async () => {
    open([]);

    expect(await screen.findByText("1 attendance device offline")).toBeInTheDocument();
    expect(
      await screen.findByText(/Attendance device “TP1 Gate” has been offline since \d\d:\d\d/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(
      screen.queryByText(/Attendance device “TP1 Gate” has been offline/),
    ).not.toBeInTheDocument();
    // The badge stays: it counts devices, the banner only reminds.
    expect(screen.getByText("1 attendance device offline")).toBeInTheDocument();
  });

  it("shows no badge and no alert when every device is online", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks/status-summary": { body: { ...SUMMARY, offline: 0, alerts: [] } },
      "GET /kiosks": { body: [] },
    });
    renderRoute("/admin/kiosks");
    await screen.findByRole("heading", { name: "Attendance devices" });

    expect(screen.queryByText(/attendance device offline/)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been offline since/)).not.toBeInTheDocument();
  });
});
