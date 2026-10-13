// The shift helpers behind the live sentence in the shift form.
import { describe, expect, it } from "vitest";
import {
  endsNextDay,
  fromMinutes,
  shiftLengthMinutes,
  shortTime,
  splitMinutes,
  toMinutes,
} from "./shift-summary";

describe("shift summary helpers", () => {
  it("reads times with or without seconds", () => {
    expect(toMinutes("07:00")).toBe(420);
    expect(toMinutes("19:30:00")).toBe(1170);
    expect(shortTime("07:00:00")).toBe("07:00");
  });

  it("measures day and night shifts", () => {
    expect(shiftLengthMinutes("07:00", "19:00")).toBe(720);
    expect(shiftLengthMinutes("19:00", "07:00")).toBe(720);
    expect(endsNextDay("19:00", "07:00")).toBe(true);
    expect(endsNextDay("07:00", "19:00")).toBe(false);
  });

  it("adds minutes to a time and wraps past midnight", () => {
    expect(fromMinutes(toMinutes("19:00") + 10)).toBe("19:10");
    expect(fromMinutes(toMinutes("23:55") + 10)).toBe("00:05");
  });

  it("splits minutes into hours and minutes", () => {
    expect(splitMinutes(240)).toEqual({ hours: 4, minutes: 0 });
    expect(splitMinutes(485)).toEqual({ hours: 8, minutes: 5 });
  });
});
