// Formatting for India (en-IN): DD/MM/YYYY dates, 24-hour IST times, 1,00,000 number grouping
// and rupees. The API sends times in UTC; they are shown in IST only here, at display time.

const INDIA_TIME_ZONE = "Asia/Kolkata";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INDIA_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INDIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const timeWithSecondsFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: INDIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const numberFormatter = new Intl.NumberFormat("en-IN");

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

/** 2026-10-12T00:30:00Z -> "12/10/2026" (the date in IST). */
export function formatDate(moment: Date | string): string {
  return dateFormatter.format(new Date(moment));
}

/** 2026-10-12T00:30:00Z -> "06:00" (the time in IST). */
export function formatTime(moment: Date | string): string {
  return timeFormatter.format(new Date(moment));
}

/** 2026-10-12T00:30:05Z -> "06:00:05" (the time in IST, with seconds, for the punch log). */
export function formatTimeWithSeconds(moment: Date | string): string {
  return timeWithSecondsFormatter.format(new Date(moment));
}

/**
 * Today's date in IST as "2026-10-14", for date inputs. The server decides by IST days, so the
 * browser's own (UTC) date would be "yesterday" between 00:00 and 05:30 IST.
 */
export function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** 100000 -> "1,00,000". */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/**
 * "16600.50" -> "₹16,600.50".
 * Money arrives from the API as a decimal string, never a float, so it is passed to Intl as a
 * string: that keeps every paisa exact (CLAUDE.md §5).
 */
export function formatRupees(amount: string): string {
  return rupeeFormatter.format(amount as Intl.StringNumericLiteral);
}
