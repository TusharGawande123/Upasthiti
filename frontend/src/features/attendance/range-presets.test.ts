// The ready-made date ranges of the range views (M5c, F-82).
import { describe, expect, it } from "vitest";
import { daysInRange, presetRange } from "./range-presets";

const TODAY = "2026-11-04";

describe("range presets", () => {
  it("counts the last 7 and 30 days with today included", () => {
    expect(presetRange("last7", TODAY)).toEqual({ from: "2026-10-29", to: TODAY });
    expect(presetRange("last30", TODAY)).toEqual({ from: "2026-10-06", to: TODAY });
    expect(daysInRange("2026-10-29", TODAY)).toBe(7);
  });

  it("starts this month on the 1st and ends today", () => {
    expect(presetRange("thisMonth", TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
  });

  it("covers the whole of last month, also across a new year and in February", () => {
    expect(presetRange("lastMonth", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("lastMonth", "2027-01-10")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(presetRange("lastMonth", "2028-03-05")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("starts this quarter on the first day of its first month", () => {
    expect(presetRange("thisQuarter", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(presetRange("thisQuarter", "2026-02-14").from).toBe("2026-01-01");
    expect(presetRange("thisQuarter", "2026-08-14").from).toBe("2026-07-01");
  });
});
