// The phone's question before an early OUT: both looks, the times in IST, the remaining time as
// the server sent it, Agree while the location is read again, and Cancel that sends nothing.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGeolocation, resetFakeReading } from "../../test/fake-geolocation";
import { type PhoneEarlyOutPrompt, phoneApi } from "./phone-api";
import { PhoneEarlyOutStep } from "./phone-early-out-step";

const HALF: PhoneEarlyOutPrompt = {
  token: "token-early-out-0001",
  client_punch_id: "11111111-1111-4111-8111-111111111111",
  expires_at: "2026-11-02T04:41:30Z",
  tier: "before_half",
  half_remaining_min: 110,
  half_at: "2026-11-02T06:30:00Z", // 12:00 IST
  full_remaining_min: 530,
  shift_end: "2026-11-02T13:30:00Z", // 19:00 IST
};
const END: PhoneEarlyOutPrompt = {
  ...HALF,
  tier: "before_end",
  half_remaining_min: null,
  half_at: null,
  full_remaining_min: 95,
};

beforeEach(() => {
  resetFakeReading();
  Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
  fakeGeolocation.watchPosition.mockImplementation((success: PositionCallback) => {
    setTimeout(
      () =>
        success({
          coords: { latitude: 19.86, longitude: 75.25, accuracy: 10 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      0,
    );
    return 1;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function show(prompt: PhoneEarlyOutPrompt) {
  const onAnswer = vi.fn();
  const onFail = vi.fn();
  const onCancel = vi.fn();
  render(
    <PhoneEarlyOutStep prompt={prompt} onAnswer={onAnswer} onFail={onFail} onCancel={onCancel} />,
  );
  return { onAnswer, onFail, onCancel };
}

describe("PhoneEarlyOutStep", () => {
  it("before the half shift: both times and the short-hours warning", () => {
    show(HALF);

    expect(
      screen.getByText("You are leaving before the shift ends. Leave now?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Your half shift is not complete yet")).toBeInTheDocument();
    expect(screen.getByText("1 h 50 min")).toBeInTheDocument();
    expect(screen.getByText("at 12:00")).toBeInTheDocument();
    expect(screen.getByText("8 h 50 min")).toBeInTheDocument();
    expect(screen.getByText("at 19:00")).toBeInTheDocument();
    expect(screen.getByText("If you leave now, your day may count as short hours.")).toBeVisible();
  });

  it("after the half shift: only the end of the shift and the half-day warning", () => {
    show(END);

    expect(screen.getByText("Your full shift is not over yet")).toBeInTheDocument();
    expect(screen.queryByText("Half shift complete in")).not.toBeInTheDocument();
    expect(screen.getByText("1 h 35 min")).toBeInTheDocument();
    expect(screen.getByText("If you leave now, your day may count as a half day.")).toBeVisible();
  });

  it("Cancel sends nothing", async () => {
    const confirm = vi.spyOn(phoneApi, "earlyOutConfirm");
    const { onCancel } = show(HALF);

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Agree reads the location and sends the token and the punch id", async () => {
    const answer = { decision: "accepted", direction: "out" } as never;
    const confirm = vi.spyOn(phoneApi, "earlyOutConfirm").mockResolvedValue(answer);
    const { onAnswer } = show(END);

    await userEvent.setup().click(screen.getByRole("button", { name: "Agree" }));

    await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith(answer));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        client_punch_id: END.client_punch_id,
        token: END.token,
        photo_jpeg: null,
        location: expect.objectContaining({ accuracy_m: 10, age_s: 0 }),
      }),
    );
  });

  it("hands a failed confirmation to the page", async () => {
    const failure = new Error("boom");
    vi.spyOn(phoneApi, "earlyOutConfirm").mockRejectedValue(failure);
    const { onFail } = show(END);

    await userEvent.setup().click(screen.getByRole("button", { name: "Agree" }));

    await vi.waitFor(() => expect(onFail).toHaveBeenCalledWith(failure));
  });
});
