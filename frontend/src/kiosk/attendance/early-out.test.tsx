// The early-OUT alert at the gate (M5, decision 0036 line 9): the screen states around it and the
// dialog itself (texts of both tiers, Agree, Cancel, Escape, the 20 second timer).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextScreen } from "./attendance-machine";
import { EarlyOutView, splitDuration } from "./early-out-view";
import { type EarlyOutPrompt, type PunchAnswer, resultKind } from "./punch-types";

const HALF_PROMPT: EarlyOutPrompt = {
  token: "token-1",
  client_punch_id: "11111111-1111-4111-8111-111111111111",
  expires_at: "2026-10-29T05:41:30Z",
  tier: "before_half",
  half_remaining_min: 110,
  half_at: "2026-10-29T07:30:00Z", // 13:00 IST
  full_remaining_min: 350,
  shift_end: "2026-10-29T11:30:00Z", // 17:00 IST
};

const END_PROMPT: EarlyOutPrompt = {
  ...HALF_PROMPT,
  tier: "before_end",
  half_remaining_min: null,
  half_at: null,
  full_remaining_min: 95,
};

function answerWith(prompt: EarlyOutPrompt | null): PunchAnswer {
  return {
    punch_id: null,
    decision: "needs_confirmation",
    direction: "out",
    employee: null,
    server_time: "2026-10-29T05:40:00Z",
    reason_code: null,
    message_key: "kiosk.punch.earlyOut",
    voice_key: "kiosk.voice.earlyOut",
    details: { kiosk_name: "Main gate" },
    early_out: prompt,
  };
}

describe("screens around the early-OUT alert", () => {
  it("opens the alert when the server asks, and goes back to checking on Agree", () => {
    const checking = { name: "checking", slow: false } as const;

    const asked = nextScreen(checking, { type: "answered", answer: answerWith(HALF_PROMPT) });
    const agreed = nextScreen(asked, { type: "early-out-agree" });

    expect(asked).toEqual({ name: "early-out", prompt: HALF_PROMPT });
    expect(agreed).toEqual({ name: "checking", slow: false });
  });

  it("goes back to scanning on Cancel and records nothing", () => {
    const asked = nextScreen(
      { name: "checking", slow: false },
      { type: "answered", answer: answerWith(HALF_PROMPT) },
    );

    expect(nextScreen(asked, { type: "early-out-cancel" })).toEqual({
      name: "scanning",
      notACard: false,
    });
  });

  it("keeps the way the punch was made (face or code) through the alert", () => {
    const asked = nextScreen(
      { name: "checking", slow: false, via: "face" },
      { type: "answered", answer: answerWith(END_PROMPT) },
    );

    expect(asked).toEqual({ name: "early-out", prompt: END_PROMPT, via: "face" });
    expect(nextScreen(asked, { type: "early-out-agree" })).toEqual({
      name: "checking",
      slow: false,
      via: "face",
    });
  });

  it("ignores the alert events on any other screen", () => {
    const scanning = { name: "scanning", notACard: false } as const;

    expect(nextScreen(scanning, { type: "early-out-agree" })).toBe(scanning);
    expect(nextScreen(scanning, { type: "early-out-cancel" })).toBe(scanning);
  });

  it("is not a result: the answer without a prompt is an unknown answer and stays a rejection", () => {
    const stuck = nextScreen(
      { name: "checking", slow: false },
      { type: "answered", answer: answerWith(null) },
    );

    expect(stuck.name).toBe("result");
    expect(resultKind(answerWith(null))).toBe("rejected");
  });
});

describe("the early-OUT dialog", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("before the half shift: the amber alert with both times and the short-hours sentence", () => {
    render(<EarlyOutView prompt={HALF_PROMPT} onAgree={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Your half shift is not complete yet")).toBeInTheDocument();
    expect(screen.getByText("1 h 50 min")).toBeInTheDocument();
    expect(screen.getByText("5 h 50 min")).toBeInTheDocument();
    expect(screen.getByText("at 13:00")).toBeInTheDocument();
    expect(screen.getByText("at 17:00")).toBeInTheDocument();
    expect(
      screen.getByText("If you leave now, your day may count as short hours."),
    ).toBeInTheDocument();
  });

  it("after the half shift: the notice with the time to the end and the half-day sentence", () => {
    render(<EarlyOutView prompt={END_PROMPT} onAgree={() => {}} onCancel={() => {}} />);

    expect(screen.getByText("Your full shift is not over yet")).toBeInTheDocument();
    expect(screen.getByText("1 h 35 min")).toBeInTheDocument();
    expect(screen.queryByText("Half shift complete in")).not.toBeInTheDocument();
    expect(
      screen.getByText("If you leave now, your day may count as a half day."),
    ).toBeInTheDocument();
  });

  it("shows only minutes under one hour and never a name", () => {
    render(
      <EarlyOutView
        prompt={{ ...END_PROMPT, full_remaining_min: 45 }}
        onAgree={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(splitDuration(110)).toEqual({ hours: 1, minutes: 50 });
  });

  it("Agree and Cancel call their own handlers; Agree is the default focus", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onAgree = vi.fn();
    const onCancel = vi.fn();
    render(<EarlyOutView prompt={HALF_PROMPT} onAgree={onAgree} onCancel={onCancel} />);

    expect(screen.getByRole("button", { name: "Agree" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Agree" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onAgree).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<EarlyOutView prompt={HALF_PROMPT} onAgree={() => {}} onCancel={onCancel} />);

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("counts down from 20 seconds and cancels by itself at zero, without agreeing", () => {
    const onAgree = vi.fn();
    const onCancel = vi.fn();
    render(<EarlyOutView prompt={HALF_PROMPT} onAgree={onAgree} onCancel={onCancel} />);
    expect(screen.getByText("Cancels in 20 s")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("Cancels in 13 s")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(13000));
    expect(onCancel).toHaveBeenCalled();
    expect(onAgree).not.toHaveBeenCalled();
  });
});
