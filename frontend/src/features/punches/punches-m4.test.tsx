// M4 additions outside the review page: the punch log's flagged, offline and review marks, chips
// and filters for every role (spec M4 §4.9, AC-29); the MIDC Waluj warning on the location
// settings (§4.11); the last-position map in the attendance device drawer (§4.7).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, type RecordedCall, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { punchItem, rejectedPunch, summary } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";
import { DeviceDrawer } from "../kiosks/device-drawer";
import type { Kiosk } from "../kiosks/use-kiosks";

const FLAGGED = punchItem({
  id: "pu-flag",
  decision: "flagged",
  reason_codes: ["LOCATION_AT_EDGE", "LOCATION_STALE"],
  review_state: "not_accepted",
  punch_time: "2026-10-20T01:00:00Z", // 06:30 IST: the time column shows the punch time
  server_received_at: "2026-10-20T03:32:00Z", // 09:02 IST: when the server got it
  was_offline: true,
});
const APPROVED = rejectedPunch("QR_EXPIRED", { review_state: "approved", review_direction: "out" });

function answers(me: unknown = SUPER_ADMIN) {
  return {
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /reviews/summary": { body: { to_check: 0, rejected_last_7_days: 0, by_code: {} } },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    "GET /kiosks": { body: [{ id: "k-1", name: "K134 main gate", plant_id: "p-1" }] },
    "GET /punches": { body: { items: [FLAGGED, APPROVED], page: 1, page_size: 50, total: 2 } },
    "GET /punches/summary": { body: summary({ flagged: 4, offline: 2, to_check: 1 }) },
  };
}

function lastQuery(calls: RecordedCall[], path: string): URLSearchParams {
  const call = [...calls].reverse().find((entry) => entry.path.split("?")[0] === path);
  return new URLSearchParams(call?.path.split("?")[1] ?? "");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("punch log marks (M4 §4.9)", () => {
  it("shows flags, the offline mark, the punch time and the review as text to every role", async () => {
    mockApi(answers(CORPORATE_HEAD));

    renderRoute("/admin/punches");

    expect(await screen.findByText("At the edge of the fence")).toBeInTheDocument();
    expect(screen.getByText("Last known location reused (offline)")).toBeInTheDocument();
    expect(screen.getByText("Offline, sent 09:02")).toBeInTheDocument();
    expect(screen.getByText("06:30:00")).toBeInTheDocument();
    expect(screen.getByText("Not accepted", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Approved as OUT")).toBeInTheDocument();
  });

  it("filters with the Flagged and Offline chips and the review filter", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();
    renderRoute("/admin/punches");

    await user.click(await screen.findByRole("button", { name: /4\s*Flagged/ }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("decision")).toBe("flagged"));
    await user.click(screen.getByRole("button", { name: /2\s*Saved offline/ }));
    await waitFor(() => expect(lastQuery(calls, "/punches").get("was_offline")).toBe("true"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Review" }), "to_check");
    await waitFor(() => expect(lastQuery(calls, "/punches").get("review_state")).toBe("to_check"));
  });
});

describe("location settings warning (M4 §4.11)", () => {
  const SETTING = {
    key: "gps_accuracy_limit_m",
    group: "kiosk",
    value: 50,
    default: 50,
    unit: "m",
    used_from: 1,
    editable: true,
    minimum: 10,
    maximum: 200,
    allowed_values: null,
  };

  it("warns about neighbouring plants only when the limit is raised", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: { settings: [SETTING] } },
    });
    const user = userEvent.setup();
    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("GPS accuracy limit");

    await user.clear(field);
    await user.type(field, "40");
    expect(screen.queryByText("Plants in MIDC Waluj are close together.")).not.toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "80");
    expect(screen.getByText("Plants in MIDC Waluj are close together.")).toBeInTheDocument();
  });
});

describe("device drawer map (M4 §4.7)", () => {
  const KIOSK = {
    id: "k-1",
    plant_id: "p-1",
    name: "K134 main gate",
    status: "active",
    registered_at: null,
    registered_accuracy_m: null,
    last_seen_at: null,
    app_version: null,
    revoked_at: null,
    revoke_reason: null,
    sound_muted: false,
    last_self_test_at: null,
    state: "online",
  } as Kiosk;

  function showDrawer(kiosk: Kiosk) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DeviceDrawer kiosk={kiosk} onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  const ANSWERS = {
    "GET /kiosks/k-1/health": { body: { days: [], latest: null } },
    "GET /plants/p-1/geofence/versions": {
      body: [
        {
          id: "g-1",
          plant_id: "p-1",
          version: 2,
          shape: "circle",
          geojson: { type: "Point", coordinates: [75.2, 19.85] },
          radius_m: "120.0",
          buffer_m: 25,
          is_current: true,
          created_at: "2026-10-01T00:00:00Z",
          created_by: null,
        },
      ],
    },
  };

  it("draws the last position when the server sent one", async () => {
    mockApi(ANSWERS);

    showDrawer({
      ...KIOSK,
      location: {
        state: "good",
        accuracy_m: 12,
        at: null,
        inside: "inside",
        lat: 19.85,
        lon: 75.2,
      },
    });

    expect(
      await screen.findByRole("img", {
        name: "Last position of this attendance device and the plant fence",
      }),
    ).toBeInTheDocument();
  });

  it("draws no map without a position (Corporate Head, or another plant's Plant Head)", async () => {
    mockApi(ANSWERS);

    showDrawer({
      ...KIOSK,
      location: { state: "good", accuracy_m: 12, at: null, inside: "inside", lat: null, lon: null },
    });

    expect(await screen.findByText("K134 main gate")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Last position/ })).not.toBeInTheDocument();
  });
});
