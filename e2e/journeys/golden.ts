// The hand-calculated numbers of the journeys (M6 AC-M6-7). Dates are worked out from the first day
// of last month, so the journeys stay inside the allowed "last year" window whenever they run, and
// the numbers below never depend on the day the test is run.

export function isoDate(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** The first day of last month (local date; the e2e machine runs in Indian time). */
export function firstOfLastMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

/** The n-th (1 = first) given weekday (0 = Sunday ... 6 = Saturday) of the month that starts on `first`. */
export function nthWeekday(first: Date, weekday: number, nth: number): Date {
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 + offset + (nth - 1) * 7);
}

export function lastOfMonth(first: Date): Date {
  return new Date(first.getFullYear(), first.getMonth() + 1, 0);
}

/**
 * The calendar journey (J-12, J-14, J-15): one permanent employee, a plant holiday on the first
 * Thursday of last month and paid leave on the first Tuesday and Wednesday. Tuesday to Thursday
 * never meet a Sunday weekly off. Nobody punches, so every other working day is Absent.
 */
export function calendarGolden(now: Date = new Date()) {
  const first = firstOfLastMonth(now);
  const holiday = nthWeekday(first, 4, 1);
  const leaveFrom = nthWeekday(first, 2, 1);
  const leaveTo = new Date(leaveFrom.getFullYear(), leaveFrom.getMonth(), leaveFrom.getDate() + 1);
  const dayColumn = (day: Date) => String(day.getDate()).padStart(2, "0");
  return {
    monthStart: isoDate(first),
    monthEnd: isoDate(lastOfMonth(first)),
    month: isoDate(first).slice(0, 7),
    holidayDate: isoDate(holiday),
    leaveFrom: isoDate(leaveFrom),
    leaveTo: isoDate(leaveTo),
    holidayColumn: dayColumn(holiday),
    leaveColumns: [dayColumn(leaveFrom), dayColumn(leaveTo)],
    // The register's "Leave" total counts the two leave days; "H" counts the one holiday.
    leaveTotal: "2",
    holidayTotal: "1",
    employeeCode: "JR-001",
    employeeName: "Calendar Journey Employee",
    plantCode: "JRN1",
  };
}

/** The seven reports of J-14 and the title each file must carry (from the report list of M5). */
export const REPORT_TITLES = {
  "daily-muster": "Daily muster",
  register: "Monthly register",
  "contractor-hours": "Contractor hours",
  "late-early-overtime": "Late, early exit and overtime",
  exceptions: "Exceptions",
  "rejected-punches": "Rejected punches",
  corrections: "Corrections",
} as const;
