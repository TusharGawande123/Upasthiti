// Fake punches for the punch log tests. All data is invented.
import type { PunchItem, PunchSummary } from "../features/punches/use-punches";

export function punchItem(overrides: Partial<PunchItem> = {}): PunchItem {
  return {
    id: "pu-1",
    server_received_at: "2026-10-20T01:32:00Z", // 07:02 IST
    employee: { id: "e-1", code: "T-2041", name: "Asha Kale" },
    employee_hidden: false,
    plant: { id: "p-1", name: "Sheet Shapers (K-134)", code: "K134" },
    kiosk: { id: "k-1", name: "K134 main gate" },
    method: "qr",
    direction: "in",
    decision: "accepted",
    reason_codes: [],
    snapshot: {
      state: "stored",
      is_dark: false,
      expires_at: "2026-12-19T01:32:00Z",
      purged_at: null,
    },
    ...overrides,
  };
}

export function rejectedPunch(code: string, overrides: Partial<PunchItem> = {}): PunchItem {
  return punchItem({
    id: `pu-${code}`,
    server_received_at: "2026-10-20T03:30:00Z", // 09:00 IST
    direction: null,
    decision: "rejected",
    reason_codes: [code],
    ...overrides,
  });
}

export function summary(overrides: Partial<PunchSummary> = {}): PunchSummary {
  return {
    accepted_in: 286,
    accepted_out: 41,
    rejected: 15,
    dark_photos: 3,
    rejected_by_reason: { QR_REVOKED: 1, WRONG_PLANT: 3, COOLDOWN_ACTIVE: 4 },
    ...overrides,
  };
}
