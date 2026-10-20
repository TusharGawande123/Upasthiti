// What a bulk action will do with each selected person, worked out on the screen so the dialog
// can say it before anything is sent. The server decides again and skips (never fails) anyone
// who cannot be done, so a wrong guess here can only change the wording, not the data.
import type { CardRow } from "./use-qr-cards";

export type SkipCode = "EMPLOYEE_NOT_QR" | "QR_CARD_EXISTS" | "NO_CARD" | "QR_CARD_REVOKED";

export type Planned = { row: CardRow; skip: SkipCode | null };

/** Issue: only people who punch by QR card and have no working card get a new card. */
export function planIssue(rows: CardRow[]): Planned[] {
  return rows.map((row) => {
    if (row.employee.punch_method !== "qr") return { row, skip: "EMPLOYEE_NOT_QR" };
    // A card that is expired or not yet valid still counts as "has a card": bulk issue never
    // replaces a card. Replace it one by one from the employee page.
    if (row.card && row.card.state !== "revoked") return { row, skip: "QR_CARD_EXISTS" };
    return { row, skip: null };
  });
}

/** Revoke and print: only cards that are not revoked. */
export function planCardAction(rows: CardRow[]): Planned[] {
  return rows.map((row) => {
    if (!row.card) return { row, skip: "NO_CARD" };
    if (row.card.state === "revoked") return { row, skip: "QR_CARD_REVOKED" };
    return { row, skip: null };
  });
}

export const doable = (plan: Planned[]) => plan.filter((item) => item.skip === null);
export const skipped = (plan: Planned[]) => plan.filter((item) => item.skip !== null);

/** Splits a list into parts of at most `size` (the print limit is 200 cards per PDF). */
export function inParts<T>(items: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    parts.push(items.slice(start, start + size));
  }
  return parts;
}
