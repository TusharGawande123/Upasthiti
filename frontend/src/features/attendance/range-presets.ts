// Ready-made date ranges for the range views (M5c, F-82): one click instead of two dates.
// All days are IST calendar days written YYYY-MM-DD. A range never reaches into the future.

export type RangePreset = "last7" | "last30" | "thisMonth" | "lastMonth" | "thisQuarter";
export const RANGE_PRESETS: RangePreset[] = [
  "last7",
  "last30",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
];

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function text(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, count: number): string {
  const date = utcDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return text(date);
}

/** The first and last day of a preset, counted from `today` (YYYY-MM-DD, IST). */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastMonth": {
      const first = new Date(Date.UTC(year, month - 2, 1));
      const last = new Date(Date.UTC(year, month - 1, 0));
      return { from: text(first), to: text(last) };
    }
    case "thisQuarter": {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${year}-${String(firstMonth).padStart(2, "0")}-01`, to: today };
    }
  }
}

/** Number of days in a range, both ends counted. */
export function daysInRange(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000) + 1;
}
