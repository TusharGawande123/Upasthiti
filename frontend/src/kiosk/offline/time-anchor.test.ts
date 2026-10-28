// The gate's own view of time while offline (M4 spec §7 rule 8): the server's anchor plus the
// time passed on a clock a person cannot change. After a reload only the wall clock is left, and
// the punch says so (`same_session: false`) so the server flags it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAnchorForTests, rememberAnchor, reportTime, serverNowMs } from "./time-anchor";

const ANCHOR = { server_time: "2026-10-28T08:00:00Z", counter: 5, token: "token" };

beforeEach(() => {
  forgetAnchorForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the time anchor", () => {
  it("has nothing to report before the first server answer", () => {
    expect(reportTime()).toBeNull();
    expect(serverNowMs()).toBeNull();
  });

  it("ignores an answer without an anchor", () => {
    rememberAnchor(undefined);
    rememberAnchor({ ...ANCHOR, token: "" });

    expect(reportTime()).toBeNull();
  });

  it("reports the time since the anchor on the monotonic clock and on the wall clock", () => {
    rememberAnchor(ANCHOR);

    vi.advanceTimersByTime(30 * 60 * 1000);
    const reported = reportTime();

    expect(reported?.anchor).toEqual(ANCHOR);
    expect(reported?.same_session).toBe(true);
    expect(reported?.elapsed_ms).toBe(30 * 60 * 1000);
    expect(reported?.wall_elapsed_ms).toBe(30 * 60 * 1000);
    expect(serverNowMs()).toBe(new Date("2026-10-28T08:30:00Z").getTime());
  });

  it("shows a moved wall clock as a difference between the two clocks", () => {
    rememberAnchor(ANCHOR);
    vi.advanceTimersByTime(10 * 60 * 1000);

    vi.setSystemTime(new Date("2026-10-27T08:00:00Z")); // somebody sets the clock a day back
    const reported = reportTime();

    expect(reported?.wall_elapsed_ms).toBeLessThan(0);
    expect(reported?.elapsed_ms).toBe(10 * 60 * 1000); // the monotonic clock is not fooled
  });

  it("after a reload only the wall clock is left and the report says it is a new session", async () => {
    rememberAnchor(ANCHOR);
    vi.resetModules();
    const reloaded = await import("./time-anchor"); // a new page load: a new session id

    vi.advanceTimersByTime(5 * 60 * 1000);
    const reported = reloaded.reportTime();

    expect(reported?.same_session).toBe(false);
    expect(reported?.elapsed_ms).toBe(0);
    expect(reported?.wall_elapsed_ms).toBe(5 * 60 * 1000);
    expect(reloaded.serverNowMs()).toBe(new Date("2026-10-28T08:05:00Z").getTime());
  });
});
