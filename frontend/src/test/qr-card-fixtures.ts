// Fake QR cards and the people who hold them, shared by the QR card tests. All data is invented.
import type { Card, CardRow } from "../features/qr-cards/use-qr-cards";
import { todayIst } from "../lib/format";

/** A date "YYYY-MM-DD" that many days from today in IST (negative = in the past). */
export function inDays(days: number): string {
  const [year = 0, month = 1, day = 1] = todayIst().split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

export function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    kind: "employee",
    serial: "C000123",
    label: null,
    state: "active",
    valid_from: inDays(-10),
    valid_until: inDays(170),
    issued_at: "2026-10-10T05:30:00Z",
    issued_by: "Tushar Gawande",
    note: null,
    print_count: 1,
    last_printed_at: "2026-10-10T05:40:00Z",
    printed_plant: { id: "p-1", name: "Sheet Shapers (K-134)", code: "K134" },
    reprint_needed: false,
    revoked_at: null,
    revoked_by: null,
    revoke_kind: null,
    revoke_reason: null,
    last_used_at: null,
    ...overrides,
  };
}

export function cardRow(
  employee: Partial<CardRow["employee"]> = {},
  cardOverrides: Partial<Card> | null = {},
): CardRow {
  return {
    employee: {
      id: "e-1",
      code: "T-2041",
      name: "Sunil More",
      type: "temporary",
      plant: { id: "p-1", name: "Sheet Shapers (K-134)", code: "K134" },
      contractor: { id: "k-1", name: "Shree Manpower" },
      category: { id: "c-1", name: "Helper" },
      punch_method: "qr",
      ...employee,
    },
    card: cardOverrides === null ? null : card(cardOverrides),
  };
}
