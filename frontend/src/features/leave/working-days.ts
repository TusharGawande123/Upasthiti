// Plain logic for the "add leave" preview: which days of a leave range are NOT counted because they
// are a weekly off or a holiday. The server counts again when the leave is saved; this only
// tells the Super Admin what to expect ("4 working days. 01/11 is a weekly off ...").

import type { Holiday } from "@/features/holidays/use-holidays";
import type { WeeklyOffItem } from "@/features/plants/use-plants";
import { addDays } from "@/lib/dates";

export const SUNDAY = 7; // the weekly off until a plant sets its own (same as the server)

/** ISO weekday of a plain date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** The weekly off in force on a date: the latest entry that started on or before it. */
export function weeklyOffOn(history: WeeklyOffItem[], isoDate: string): number {
  const started = history
    .filter((item) => item.effective_from <= isoDate)
    .sort(
      (a, b) =>
        a.effective_from.localeCompare(b.effective_from) ||
        a.created_at.localeCompare(b.created_at),
    );
  return started.at(-1)?.weekday ?? SUNDAY;
}

export type SkippedDay = { date: string; reason: "weekly_off" | "holiday" };

export type RangeCount = { workingDays: number; skipped: SkippedDay[] };

/** Counts the working days from `from` to `to` (both included). Weekly off wins over a holiday. */
export function countWorkingDays(
  from: string,
  to: string,
  weeklyOffHistory: WeeklyOffItem[],
  holidays: Holiday[],
  plantId: string,
): RangeCount {
  const holidayDates = new Set(
    holidays
      .filter((holiday) => !holiday.cancelled)
      .filter((holiday) => holiday.all_plants || holiday.plants.some((p) => p.id === plantId))
      .map((holiday) => holiday.date),
  );
  const skipped: SkippedDay[] = [];
  let workingDays = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isoWeekday(date) === weeklyOffOn(weeklyOffHistory, date)) {
      skipped.push({ date, reason: "weekly_off" });
    } else if (holidayDates.has(date)) {
      skipped.push({ date, reason: "holiday" });
    } else {
      workingDays += 1;
    }
  }
  return { workingDays, skipped };
}
