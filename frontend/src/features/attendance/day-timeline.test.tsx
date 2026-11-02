// The timeline of one day: every kind of line (punch, review, correction, leave, holiday,
// weekly off) with its words, and the punch log link only when allowed.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { DayTimeline } from "./day-timeline";
import type { TimelineItem } from "./use-day-detail";

function punch(changes: Partial<Extract<TimelineItem, { kind: "punch" }>> = {}): TimelineItem {
  return {
    kind: "punch",
    punch_id: "pu-1",
    punch_time: "2026-10-29T03:30:00Z",
    direction: "in",
    decision: "accepted",
    counts: true,
    role: "first_in",
    ignored_by_correction_id: null,
    kiosk: { id: "k-1", name: "Main gate phone" },
    method: "face",
    was_offline: false,
    carry_over: false,
    ...changes,
  };
}

function correction(
  changes: Partial<Extract<TimelineItem, { kind: "correction" }>> = {},
): TimelineItem {
  return {
    kind: "correction",
    correction_id: "c-1",
    correction_kind: "add_in_out",
    direction: null,
    in_time: "2026-10-29T03:30:00Z",
    out_time: "2026-10-29T11:30:00Z",
    status_value: "present",
    punch_id: null,
    state: "approved",
    reason: "Forgot to punch",
    requested_by: "Asha Rao",
    requested_at: "2026-10-29T12:00:00Z",
    decided_by: "Tushar Gawande",
    decided_at: "2026-10-29T13:00:00Z",
    decision_reason: "Checked with the supervisor",
    ...changes,
  };
}

function show(items: TimelineItem[], canOpenPunchLog = false) {
  render(
    <MemoryRouter>
      <DayTimeline items={items} canOpenPunchLog={canOpenPunchLog} />
    </MemoryRouter>,
  );
}

describe("day timeline", () => {
  it("shows a counted face punch with its role and the punch log link", () => {
    show([punch()], true);
    expect(screen.getByText("Main gate phone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /punch log/i })).toBeInTheDocument();
  });

  it("shows an offline, flagged, not counted out punch that a correction ignored", () => {
    show([
      punch({
        direction: "out",
        counts: false,
        decision: "flagged",
        role: "extra",
        ignored_by_correction_id: "c-1",
        was_offline: true,
        carry_over: true,
        kiosk: null,
        method: "qr",
      }),
      punch({ role: "last_out", punch_id: "pu-2" }),
    ]);
    expect(screen.queryByRole("link", { name: /punch log/i })).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("shows reviews with and without a reason, and every wording of the action", () => {
    const review = (action: string, reason: string | null, direction: "in" | "out" | null) =>
      ({
        kind: "review",
        punch_id: "pu-1",
        action,
        direction,
        reviewed_by: { id: "u-1", name: "Tushar Gawande" },
        reviewed_at: "2026-10-29T14:00:00Z",
        reason,
      }) as TimelineItem;
    show([
      review("approved", "Looked fine", "in"),
      review("approved", null, "out"),
      review("not_accepted", null, null),
      review("confirmed", null, null),
      review("something_new", null, null),
    ]);
    expect(screen.getByText("Looked fine")).toBeInTheDocument();
    expect(screen.getByText("something_new")).toBeInTheDocument();
  });

  it("shows corrections: approved with a decision, and a pending status-only one", () => {
    show([
      correction(),
      correction({
        correction_id: "c-2",
        correction_kind: "set_status",
        in_time: null,
        out_time: null,
        status_value: "half_day",
        state: "pending",
        decided_by: null,
        decided_at: null,
        decision_reason: null,
      }),
      correction({
        correction_id: "c-3",
        in_time: null,
        out_time: null,
        status_value: null,
      }),
    ]);
    expect(screen.getAllByText("Forgot to punch")).toHaveLength(3);
    expect(screen.getAllByText("Checked with the supervisor").length).toBeGreaterThan(0);
  });

  it("shows leave, holiday and weekly off lines, and ignores an unknown kind", () => {
    show([
      { kind: "leave", leave_id: "l-1", is_paid: true, reason: "Family function" },
      { kind: "leave", leave_id: "l-2", is_paid: false, reason: null },
      { kind: "holiday", holiday_id: "h-1" },
      { kind: "weekly_off" },
      { kind: "mystery" } as unknown as TimelineItem,
    ]);
    expect(screen.getByText("Family function")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
