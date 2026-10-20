// The date helpers must agree with the server's rules for a card's end date.
import { describe, expect, it } from "vitest";
import { addDays, addMonths, defaultValidUntil } from "./dates";

describe("addDays", () => {
  it("moves across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-11-01", 6, "2027-05-01"],
    ["2026-08-31", 6, "2027-02-28"], // a shorter month gives its last day
    ["2027-08-31", 6, "2028-02-29"], // leap year
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-10-20", 36, "2029-10-20"],
    ["2026-10-20", 0, "2026-10-20"],
  ])("%s + %i months = %s", (start, months, expected) => {
    expect(addMonths(start, months)).toBe(expected);
  });
});

describe("defaultValidUntil", () => {
  it("is the start plus the months minus one day", () => {
    expect(defaultValidUntil("2026-10-20", 6)).toBe("2027-04-19");
    expect(defaultValidUntil("2026-11-01", 6)).toBe("2027-04-30");
    expect(defaultValidUntil("2026-08-31", 6)).toBe("2027-02-27");
  });
});
