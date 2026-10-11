// en-IN / IST formatting helpers (spec AC-9).
import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, formatRupees, formatTime } from "./format";

describe("en-IN / IST formatting (spec AC-9)", () => {
  it("shows the IST date as DD/MM/YYYY", () => {
    expect(formatDate("2026-10-12T00:30:00Z")).toBe("12/10/2026");
  });

  it("moves to the next day when UTC evening is already past midnight in IST", () => {
    expect(formatDate("2026-10-11T20:00:00Z")).toBe("12/10/2026");
  });

  it("shows the IST time in 24-hour HH:mm", () => {
    expect(formatTime("2026-10-12T00:30:00Z")).toBe("06:00");
    expect(formatTime("2026-10-12T12:45:00Z")).toBe("18:15");
  });

  it("groups numbers the Indian way", () => {
    expect(formatNumber(100000)).toBe("1,00,000");
    expect(formatNumber(12345678)).toBe("1,23,45,678");
  });

  it("formats rupees from an exact decimal string", () => {
    expect(formatRupees("16600")).toBe("₹16,600.00");
    expect(formatRupees("100000.10")).toBe("₹1,00,000.10");
  });
});
