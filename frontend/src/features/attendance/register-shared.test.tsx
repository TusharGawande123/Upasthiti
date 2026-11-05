// The totals of a person in the register: overtime is for temporary workers only (M5c AC-29).
import { describe, expect, it } from "vitest";
import { DASH, totalColumns } from "./register-shared";
import type { Totals } from "./use-attendance-admin";

const TOTALS: Totals = {
  present: 20,
  half_day: 1,
  short_hours: 0,
  absent: 1,
  incomplete: 0,
  leave_paid: 1,
  leave_unpaid: 0,
  weekly_off: 4,
  holiday: 1,
  worked_on_off_day: 0,
  worked_min: 9600,
  overtime_min: 150,
  late_count: 2,
  late_min: 40,
  early_exit_count: 0,
};

const overtimeOf = (overtimeApplies: boolean) =>
  totalColumns(TOTALS, (key) => key, overtimeApplies).find(
    (column) => column.key === "overtimeHours",
  )?.value;

describe("register totals", () => {
  it("show a dash instead of the overtime of a permanent employee", () => {
    expect(overtimeOf(false)).toBe(DASH);
  });

  it("show the overtime of a temporary worker", () => {
    expect(overtimeOf(true)).toBe("2 h 30 m");
  });
});
