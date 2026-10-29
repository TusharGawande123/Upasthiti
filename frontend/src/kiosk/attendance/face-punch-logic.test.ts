// The face punch without any screen or camera (spec M3 §4.2 to §4.6, §5): the guidance hints, the
// head-turn picture schedule, the screen state machine, the requests and the picture size.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { Measure } from "@/lib/face-guide/pose-estimate";
import { nextScreen, RETRY_SECONDS, secondsOnScreen } from "./attendance-machine";
import { frameSize } from "./face-capture";
import {
  CaptureTracker,
  GOOD_FOR_MS,
  GuideTracker,
  readGuide,
  TIMED_STEP_MS,
  TURN_MARGIN_DEGREES,
  TURN_PER_DEGREE,
  turnReached,
} from "./face-sequence";
import { feedbackFor } from "./feedback";
import { type Challenge, requestChallenge, sendEmployeeCode, sendFacePunch } from "./punch-client";
import { canTryAgain, type PunchAnswer, resultKind } from "./punch-types";

function face(changes: Partial<Measure> = {}): Measure {
  return { turn: 0, noseHeight: 0.5, faceSize: 0.25, centre: { x: 0.5, y: 0.45 }, ...changes };
}

function answer(changes: Partial<PunchAnswer> = {}): PunchAnswer {
  return {
    punch_id: "p-1",
    decision: "rejected",
    direction: null,
    employee: null,
    server_time: "2026-10-24T01:32:00Z",
    reason_code: "NO_FACE",
    message_key: "kiosk.punch.NO_FACE",
    voice_key: "kiosk.punch.NO_FACE.voice",
    details: { kiosk_name: "Main gate", retry_allowed: true },
    ...changes,
  };
}

const CODE_ENTRY = { token: "t".repeat(43), expires_at: "2026-10-24T01:34:00Z", tries_left: 2 };
const SETTINGS = { result_seconds: 4, reject_seconds: 6 };

describe("guidance hints", () => {
  it("is good for one centred face of the right size", () => {
    expect(readGuide([face()], false)).toEqual({ good: true, hint: null });
  });

  it("says what to change", () => {
    expect(readGuide([face({ faceSize: 0.05 })], false).hint).toBe("closer");
    expect(readGuide([face({ faceSize: 0.6 })], false).hint).toBe("farther");
    expect(readGuide([face(), face()], false).hint).toBe("one_person");
    expect(readGuide([face({ centre: { x: 0.9, y: 0.45 } })], false).hint).toBe("centre");
  });

  it("says nothing when no face is seen, and asks for light only in the dark", () => {
    expect(readGuide([], false)).toEqual({ good: false, hint: null });
    expect(readGuide([], true)).toEqual({ good: false, hint: "light" });
  });

  it("takes the picture as good when MediaPipe could not load (timed fallback)", () => {
    expect(readGuide(null, false).good).toBe(true);
  });

  it("is ready only after the face was good for half a second in a row", () => {
    const tracker = new GuideTracker();
    expect(tracker.update(0, true).ready).toBe(false);
    expect(tracker.update(GOOD_FOR_MS - 1, true).ready).toBe(false);
    expect(tracker.update(GOOD_FOR_MS - 1, false).ready).toBe(false); // the face moved: start over
    expect(tracker.update(1_000, true).ready).toBe(false);
    expect(tracker.update(1_000 + GOOD_FOR_MS, true).ready).toBe(true);
  });
});

describe("the head turn", () => {
  const peak = (28 + TURN_MARGIN_DEGREES) * TURN_PER_DEGREE;

  it("counts the turn towards the person's own left as positive", () => {
    expect(turnReached(face({ turn: peak }), "left", 18)).toBe(true);
    expect(turnReached(face({ turn: peak }), "right", 18)).toBe(false);
    expect(turnReached(face({ turn: -peak }), "right", 18)).toBe(true);
    expect(turnReached(face({ turn: 0.1 }), "left", 18)).toBe(false); // not far enough yet
  });

  it("takes frontal, turn, frontal with MediaPipe watching", () => {
    const tracker = new CaptureTracker(["left"], 18, true);
    expect(tracker.start(0)).toEqual({ type: "take", role: "frontal" });
    expect(tracker.shown).toEqual({ phase: "turn", direction: "left", index: 0 });

    expect(tracker.update(100, [face()])).toEqual({ type: "none" });
    expect(tracker.update(200, [face({ turn: peak })])).toEqual({ type: "take", role: "turn" });
    expect(tracker.shown).toEqual({ phase: "straight" });
    // Straight again, but only after it was held for a moment.
    expect(tracker.update(300, [face({ turn: peak })])).toEqual({ type: "none" });
    expect(tracker.update(400, [face()])).toEqual({ type: "none" });
    expect(tracker.update(750, [face()])).toEqual({ type: "take", role: "frontal" });
    expect(tracker.done).toBe(true);
    expect(tracker.update(900, [face()])).toEqual({ type: "none" });
  });

  it("does nothing while no face or two faces are seen", () => {
    const tracker = new CaptureTracker(["right"], 18, true);
    tracker.start(0);
    expect(tracker.update(100, [])).toEqual({ type: "none" });
    expect(tracker.update(200, [face({ turn: -peak }), face()])).toEqual({ type: "none" });
  });

  it("asks for two turns in the server's order (F-43): four frames in all", () => {
    const tracker = new CaptureTracker(["right", "left"], 18, true);
    const actions = [tracker.start(0)];
    actions.push(tracker.update(100, [face({ turn: -peak })]));
    expect(tracker.shown).toEqual({ phase: "turn", direction: "left", index: 1 });
    actions.push(tracker.update(200, [face({ turn: peak })]));
    tracker.update(300, [face()]);
    actions.push(tracker.update(700, [face()]));
    expect(actions).toEqual([
      { type: "take", role: "frontal" },
      { type: "take", role: "turn" },
      { type: "take", role: "turn" },
      { type: "take", role: "frontal" },
    ]);
  });

  it("works on a timed schedule without MediaPipe: a picture every 1.5 s", () => {
    const tracker = new CaptureTracker(["left"], 18, false);
    expect(tracker.start(1_000)).toEqual({ type: "take", role: "frontal" });
    expect(tracker.update(1_000 + TIMED_STEP_MS - 1, null)).toEqual({ type: "none" });
    expect(tracker.update(1_000 + TIMED_STEP_MS, null)).toEqual({ type: "take", role: "turn" });
    expect(tracker.shown).toEqual({ phase: "straight" });
    expect(tracker.update(1_000 + 2 * TIMED_STEP_MS, null)).toEqual({
      type: "take",
      role: "frontal",
    });
    expect(tracker.done).toBe(true);
  });
});

describe("screens of a face punch", () => {
  const scanning = { name: "scanning", notACard: false } as const;
  const turnLeft = { phase: "turn", direction: "left", index: 0 } as const;
  const startOfGuide = { name: "face-guide", timedOut: false } as const;

  it("goes guide, challenge, checking, result, scanning", () => {
    let screen = nextScreen(scanning, { type: "face-start" });
    expect(screen).toEqual(startOfGuide);
    screen = nextScreen(screen, { type: "face-ready", shown: turnLeft });
    expect(screen).toEqual({ name: "face-challenge", shown: turnLeft });
    screen = nextScreen(screen, { type: "face-step", shown: { phase: "straight" } });
    expect(screen).toEqual({ name: "face-challenge", shown: { phase: "straight" } });
    screen = nextScreen(screen, { type: "face-sent" });
    expect(screen).toEqual({ name: "checking", slow: false, via: "face" });
    screen = nextScreen(screen, { type: "slow" });
    expect(screen).toEqual({ name: "checking", slow: true, via: "face" });
    screen = nextScreen(screen, { type: "answered", answer: answer() });
    expect(screen).toMatchObject({ name: "result", via: "face" });
    expect(nextScreen(screen, { type: "screen-over" })).toEqual(scanning);
  });

  it("starts a face punch only from the scanning screen", () => {
    const result = { name: "result", answer: answer() } as const;
    expect(nextScreen(result, { type: "face-start" })).toBe(result);
    const getReady = { name: "get-ready", payload: "UPS1.A" } as const;
    expect(nextScreen(getReady, { type: "face-start" })).toBe(getReady);
  });

  it("shows the 'could not see your face' text, then tries again or cancels", () => {
    const timedOut = nextScreen(startOfGuide, { type: "face-guide-timeout" });
    expect(timedOut).toEqual({ name: "face-guide", timedOut: true });
    expect(nextScreen(timedOut, { type: "face-retry" })).toEqual(startOfGuide);
    expect(nextScreen(timedOut, { type: "face-cancel" })).toEqual(scanning);
  });

  it("opens the code pad when the server is unsure, and again after a wrong code", () => {
    const checking = { name: "checking", slow: false, via: "face" } as const;
    const needsCode = answer({
      decision: "needs_code",
      reason_code: "NEED_EMPLOYEE_CODE",
      code_entry: CODE_ENTRY,
    });
    const pad = nextScreen(checking, { type: "answered", answer: needsCode });
    expect(pad).toEqual({ name: "code-entry", entry: CODE_ENTRY, wrong: false });

    const afterCode = nextScreen(pad, { type: "code-sent" });
    expect(afterCode).toEqual({
      name: "checking",
      slow: false,
      via: "code",
      entry: CODE_ENTRY,
    });
    const wrong = answer({
      decision: "needs_code",
      reason_code: "CODE_NOT_MATCHED",
      code_entry: { ...CODE_ENTRY, tries_left: 1 },
    });
    expect(nextScreen(afterCode, { type: "answered", answer: wrong })).toEqual({
      name: "code-entry",
      entry: { ...CODE_ENTRY, tries_left: 1 },
      wrong: true,
    });
  });

  it("fails from every waiting face screen", () => {
    const waiting = [
      startOfGuide,
      { name: "face-challenge", shown: turnLeft },
      { name: "code-entry", entry: CODE_ENTRY, wrong: false },
    ] as const;
    for (const screen of waiting) {
      expect(nextScreen(screen, { type: "failed", code: "FACE_SERVICE_BUSY" })).toEqual({
        name: "failed",
        code: "FACE_SERVICE_BUSY",
      });
    }
  });

  it("offers 'Try again' after 'Too slow' and after a rejection that can be retried", () => {
    const tooSlow = { name: "failed", code: "CHALLENGE_EXPIRED" } as const;
    expect(nextScreen(tooSlow, { type: "face-retry" })).toEqual(startOfGuide);
    const offline = { name: "failed", code: "NETWORK_OFFLINE" } as const;
    expect(nextScreen(offline, { type: "face-retry" })).toBe(offline);

    const retryable = { name: "result", answer: answer() } as const;
    expect(nextScreen(retryable, { type: "face-retry" })).toEqual(startOfGuide);
    expect(secondsOnScreen(retryable, SETTINGS)).toBe(RETRY_SECONDS);
    expect(secondsOnScreen(tooSlow, SETTINGS)).toBe(RETRY_SECONDS);
    const final = answer({ details: { kiosk_name: "Main gate" } });
    expect(secondsOnScreen({ name: "result", answer: final }, SETTINGS)).toBe(6);
  });

  it("knows which answers allow another try", () => {
    expect(canTryAgain(answer())).toBe(true);
    expect(canTryAgain(answer({ details: { kiosk_name: "G", retry_allowed: false } }))).toBe(false);
    expect(canTryAgain(answer({ decision: "accepted", reason_code: null }))).toBe(false);
    expect(resultKind(answer({ decision: "needs_code" }))).toBe("needs-code");
  });
});

describe("sound and voice of the face screens", () => {
  it("ticks while the head turns and asks for the code in words", () => {
    const shown = { phase: "straight" } as const;
    expect(feedbackFor({ name: "face-challenge", shown })).toEqual({
      tone: "tick",
      voiceKey: null,
    });
    expect(feedbackFor({ name: "code-entry", entry: CODE_ENTRY, wrong: false })?.voiceKey).toBe(
      "kiosk.voice.needCode",
    );
  });

  it("speaks the face wording for a wrong plant after a face punch only", () => {
    const wrongPlant = answer({ reason_code: "WRONG_PLANT", details: { kiosk_name: "G" } });
    expect(feedbackFor({ name: "result", answer: wrongPlant, via: "face" })?.voiceKey).toBe(
      "kiosk.punch.WRONG_PLANT_FACE.voice",
    );
    expect(feedbackFor({ name: "result", answer: wrongPlant })?.voiceKey).toBe(
      "kiosk.punch.WRONG_PLANT.voice",
    );
  });
});

describe("requests", () => {
  const challenge: Challenge = {
    challenge_nonce: "n".repeat(22),
    challenge: "turn_left",
    expires_at: "2026-10-24T01:32:10Z",
    server_time: "2026-10-24T01:32:00Z",
    capture: {
      min_frames: 2,
      max_frames: 4,
      max_width: 640,
      max_height: 480,
      max_frame_bytes: 70000,
      min_yaw_degrees: 18,
    },
  };

  it("gets a challenge", async () => {
    const send = vi.fn().mockResolvedValue(challenge);
    expect(await requestChallenge({ send })).toEqual({ kind: "challenge", challenge });
  });

  it("does not retry a busy face service and names it on the screen", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError("FACE_SERVICE_BUSY", "busy", 503));
    expect(await requestChallenge({ send })).toEqual({ kind: "failed", code: "FACE_SERVICE_BUSY" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends the frames with the nonce, and retries once with the same body", async () => {
    const bodies: unknown[] = [];
    const send = vi
      .fn()
      .mockImplementationOnce(async (body: unknown) => {
        bodies.push(body);
        throw new ApiError("NETWORK_ERROR", "offline", 0);
      })
      .mockImplementationOnce(async (body: unknown) => {
        bodies.push(body);
        return answer({ decision: "accepted", reason_code: null });
      });
    const frames = [
      { role: "frontal", jpeg: "AA" },
      { role: "turn", jpeg: "BB" },
    ] as const;
    const outcome = await sendFacePunch(
      { challengeNonce: challenge.challenge_nonce, frames: [...frames], location: null },
      { send },
    );

    expect(outcome.kind).toBe("answer");
    expect(bodies[0]).toBe(bodies[1]); // same client_punch_id on the retry
    expect(bodies[0]).toMatchObject({ method: "face", challenge_nonce: challenge.challenge_nonce });
  });

  it("sends a typed code with the token, a new id for each try", async () => {
    const send = vi.fn().mockResolvedValue(answer({ decision: "accepted", reason_code: null }));
    await sendEmployeeCode({ token: CODE_ENTRY.token, code: "EMP-0312" }, { send });
    await sendEmployeeCode({ token: CODE_ENTRY.token, code: "EMP-0312" }, { send });

    const [first, second] = send.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ code_entry_token: CODE_ENTRY.token, employee_code: "EMP-0312" });
    expect(first.client_punch_id).not.toBe(second.client_punch_id);
  });
});

describe("picture size", () => {
  it("fits inside 640 x 480, keeps the camera's shape and never enlarges", () => {
    expect(frameSize(1280, 960)).toEqual({ width: 640, height: 480 });
    expect(frameSize(1280, 720)).toEqual({ width: 640, height: 360 });
    expect(frameSize(480, 640)).toEqual({ width: 360, height: 480 });
    expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 });
  });
});
