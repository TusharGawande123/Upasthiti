// The new attendance pages are reachable from the phone menu and the Ctrl+K palette, and the
// small helpers behind the list (tile mapping, day address, durations) do what they promise.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { addMinutesToClock, formatDay, formatDuration } from "./attendance-format";
import { filtersForShow } from "./show-filters";
import { parseDayParam } from "./use-day-drawer";

afterEach(() => vi.unstubAllGlobals());

describe("menu entries", () => {
  it.each([
    ["Corporate Head", CORPORATE_HEAD],
    ["Plant Head", PLANT_HEAD],
  ])(
    "show Attendance, Monthly register and Corrections to a %s in the phone menu",
    async (_name, me) => {
      mockApi({ "GET /auth/me": { body: me } });
      const user = userEvent.setup();

      renderRoute("/admin");
      await user.click(await screen.findByRole("button", { name: "Open the menu" }));

      const menu = within(await screen.findByRole("dialog", { name: "Main menu" }));
      expect(menu.getByRole("link", { name: "Attendance" })).toHaveAttribute(
        "href",
        "/admin/attendance",
      );
      expect(menu.getByRole("link", { name: "Monthly register" })).toBeInTheDocument();
      expect(menu.getByRole("link", { name: "Corrections" })).toHaveAttribute(
        "href",
        "/admin/corrections",
      );
    },
  );
});

describe("helpers", () => {
  it("formats durations, clock times and days", () => {
    expect(formatDuration(465)).toBe("7 h 45 m");
    expect(formatDuration(480)).toBe("8 h");
    expect(formatDuration(45)).toBe("45 m");
    expect(addMinutesToClock("23:30:00", 45)).toBe("00:15");
    expect(formatDay("2026-10-29")).toBe("29/10/2026");
  });

  it("reads the day address and ignores a broken one", () => {
    expect(parseDayParam("e-1:2026-10-29")).toEqual({ employeeId: "e-1", date: "2026-10-29" });
    expect(parseDayParam("e-1:yesterday")).toBeNull();
    expect(parseDayParam(null)).toBeNull();
  });

  it("knows the tiles of the dashboard and nothing else", () => {
    expect(filtersForShow("on_leave")).toEqual({ status: "leave", exact: true });
    expect(filtersForShow("nonsense")).toBeNull();
    expect(filtersForShow(null)).toBeNull();
  });
});
