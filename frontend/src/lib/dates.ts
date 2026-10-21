// Date arithmetic on plain "YYYY-MM-DD" dates (no time zone, no clock). The card dialogs use it to
// suggest an end date; the server checks every date again.

function parts(isoDate: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return [year, month, day];
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-10-31" + 1 -> "2026-11-01". */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = parts(isoDate);
  return toIso(new Date(Date.UTC(year, month - 1, day + days)));
}

/**
 * The same day number some months later; a month that is too short gives its last day
 * ("2026-08-31" + 6 months = "2027-02-28"). This is the same rule as on the server.
 */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = parts(isoDate);
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))));
}

/** Start + N months - 1 day: a 6-month card from 20/10/2026 ends on 19/04/2027. */
export function defaultValidUntil(start: string, months: number): string {
  return addDays(addMonths(start, months), -1);
}

const ISTDATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const ISTTIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The IST date ("2026-10-20") and time ("07:02") of an instant, for date and time inputs. */
export function istDateAndTime(moment: Date | string): { date: string; time: string } {
  const instant = new Date(moment);
  return { date: ISTDATE.format(instant), time: ISTTIME.format(instant) };
}

/** "2026-10-20" and "23:59" typed in IST become an exact instant for the server. */
export function istToIso(date: string, time: string): string {
  return `${date}T${time}:00+05:30`;
}
