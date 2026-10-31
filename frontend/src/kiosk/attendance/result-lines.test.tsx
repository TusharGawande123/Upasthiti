// The two small server lines under IN or OUT (M5 F-37 late hint, F-2 month line): shown only when
// the server sends them, with numbers only.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PunchAnswer } from "./punch-types";
import { ResultView } from "./result-view";

function inAnswer(gateLines: PunchAnswer["gate_lines"]): PunchAnswer {
  return {
    punch_id: "22222222-2222-4222-8222-222222222222",
    decision: "accepted",
    direction: "in",
    employee: { display_name: "Asha Patil", employee_code: "P-1" },
    server_time: "2026-10-29T04:10:00Z",
    reason_code: null,
    message_key: "kiosk.punch.in",
    voice_key: "kiosk.voice.in",
    details: { kiosk_name: "Main gate" },
    gate_lines: gateLines,
  };
}

function show(answer: PunchAnswer) {
  render(
    <ResultView
      answer={answer}
      serverOffsetMs={0}
      title="Gate attendance"
      subtitle="Main gate"
      online
      seconds={4}
    />,
  );
}

describe("gate result lines", () => {
  it("shows the late minutes and the days present this month", () => {
    show(inAnswer({ late_minutes: 12, month_days_present: 9 }));
    expect(screen.getByText(/Late by 12 min/)).toBeInTheDocument();
    expect(screen.getByText(/Days present this month: 9/)).toBeInTheDocument();
  });

  it("shows only the line the server sent", () => {
    show(inAnswer({ late_minutes: null, month_days_present: 3 }));
    expect(screen.queryByText(/Late by/)).not.toBeInTheDocument();
    expect(screen.getByText(/Days present this month: 3/)).toBeInTheDocument();
  });

  it("shows nothing extra without gate lines", () => {
    show(inAnswer(null));
    expect(screen.queryByText(/Late by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Days present/)).not.toBeInTheDocument();
  });
});
