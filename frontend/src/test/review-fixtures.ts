// Fake punches, review contexts and the fake server answers shared by the "Needs review" tests.
// All data is invented.
import type { PunchItem } from "../features/punches/use-punches";
import type { ReviewContext, ReviewListItem } from "../features/review/use-review";
import { type mockApi, type RecordedCall, SUPER_ADMIN } from "./mock-api";
import { PLANT_K134, page } from "./people-fixtures";
import { punchItem, rejectedPunch } from "./punch-fixtures";

export const EDGE = punchItem({
  id: "pu-edge",
  server_received_at: "2026-10-27T02:12:00Z", // 07:42 IST
  punch_time: "2026-10-27T02:12:00Z",
  decision: "flagged",
  reason_codes: ["LOCATION_AT_EDGE"],
  review_state: "to_check",
});
export const OFFLINE = punchItem({
  id: "pu-offline",
  employee: { id: "e-2", code: "T-3050", name: "Ravi Shinde" },
  server_received_at: "2026-10-27T03:04:00Z",
  punch_time: "2026-10-27T02:12:00Z",
  was_offline: true,
  offline_delay_seconds: 52 * 60,
  decision: "flagged",
  direction: "out",
  reason_codes: ["IMPOSSIBLE_TRAVEL"],
  review_state: "to_check",
});
export const SPOOF = rejectedPunch("SPOOF_SUSPECTED", {
  id: "pu-spoof",
  method: "face",
  employee: null,
  punch_time: "2026-10-27T02:30:00Z",
});
export const NOBODY = rejectedPunch("QR_SIGNATURE_INVALID", { id: "pu-nobody", employee: null });

export function row(punch: PunchItem, extra: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    punch: { time_proof: null, claimed_employee: null, ...punch },
    latest_review: null,
    approvable: false,
    ...extra,
  };
}

export const SPOOF_ROW = row(SPOOF, {
  approvable: true,
  punch: {
    ...SPOOF,
    time_proof: null,
    claimed_employee: { id: "e-1", code: "T-2041", name: "Asha Kale" },
  },
});

export function context(punch: PunchItem, extra: Partial<ReviewContext> = {}): ReviewContext {
  return {
    punch: {
      ...punch,
      app_version: "test",
      face: null,
      location: { lat: 19.85, lon: 75.2, accuracy_m: 12 },
      location_age_s: 3,
      reviews: [],
    },
    claimed_employee: null,
    geofence: {
      version_id: "g-1",
      version: 3,
      shape: "circle",
      geojson: { type: "Point", coordinates: [75.2, 19.85] },
      radius_m: 120,
      buffer_m: 25,
      was_current_at_punch_time: true,
    },
    distance_m: 18,
    margin_m: 25,
    related: [],
    suggestion: null,
    nearby_counted: [],
    reviews: [],
    hints: [],
    approvable: false,
    limits: { impossible_travel_kmh: 60, punch_cooldown_minutes: 2 },
    ...extra,
  };
}

export type Answers = Parameters<typeof mockApi>[0];

export function answers(
  extra: Answers = {},
  items: ReviewListItem[] = [row(EDGE), row(OFFLINE)],
): Answers {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /kiosks/status-summary": {
      body: { online: 1, offline: 0, needs_location: 0, sending: 0, alerts: [] },
    },
    "GET /kiosks": { body: [{ id: "k-1", name: "K134 main gate", plant_id: "p-1" }] },
    "GET /reviews/summary": { body: { to_check: 7, rejected_last_7_days: 3, by_code: {} } },
    "GET /reviews": { body: { items, page: 1, page_size: 50, total: items.length } },
    ...extra,
  };
}

export function lastQuery(calls: RecordedCall[], path: string): URLSearchParams {
  const call = [...calls].reverse().find((entry) => entry.path.split("?")[0] === path);
  return new URLSearchParams(call?.path.split("?")[1] ?? "");
}

export function posts(calls: RecordedCall[]) {
  return calls.filter((call) => call.method === "POST");
}
