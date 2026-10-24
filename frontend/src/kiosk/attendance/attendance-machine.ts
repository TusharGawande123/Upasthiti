// Which screen the kiosk shows, as a small state machine (spec M2 §4.1 to §4.5).
//
//   starting -> scanning -> get-ready -> checking -> result -> scanning
//   (get-ready: the card is read and the worker gets time to look at the camera; "I am ready"
//    or the end of the time takes the photo, "Cancel" goes back to scanning)
//   checking or get-ready -> failed (no internet...) -> scanning
//   starting -> needs-tap ("Start camera") / camera-problem (blocked, not found)
//   Face punch (spec M3 §4.2 to §4.6), started by the "Punch with face" button:
//   scanning -> face-guide -> face-challenge -> checking -> result -> scanning
//   checking -> code-entry (the server was not sure) -> checking -> result
//   (a result that allows a retry goes back to face-guide when the person taps "Try again")
//
// Only one punch at a time: a card is accepted only on the scanning screen. Every other
// event that does not fit the current screen is ignored.
import type { CameraProblem } from "./camera";
import type { CaptureShown } from "./face-sequence";
import {
  type CodeEntry,
  canTryAgain,
  canTryAgainAfterFailure,
  type PunchAnswer,
  resultKind,
} from "./punch-types";

export type AttendanceScreen =
  | { name: "starting" }
  | { name: "needs-tap" }
  | { name: "camera-problem"; code: CameraProblem | "BROWSER_NOT_SUPPORTED" }
  | { name: "scanning"; notACard: boolean }
  | { name: "get-ready"; payload: string }
  | { name: "face-guide"; timedOut: boolean }
  | { name: "face-challenge"; shown: CaptureShown }
  | { name: "code-entry"; entry: CodeEntry; wrong: boolean }
  | { name: "checking"; slow: boolean; via?: "face" | "code" }
  | { name: "result"; answer: PunchAnswer; via?: "face" | "code" }
  | { name: "failed"; code: string };

export type AttendanceEvent =
  | { type: "camera-ready" }
  | { type: "camera-needs-tap" }
  | { type: "camera-failed"; code: CameraProblem | "BROWSER_NOT_SUPPORTED" }
  | { type: "not-a-card" }
  | { type: "not-a-card-over" }
  | { type: "card-read"; payload: string }
  | { type: "photo-taken" }
  | { type: "photo-cancelled" }
  | { type: "face-start" }
  | { type: "face-guide-timeout" }
  | { type: "face-retry" }
  | { type: "face-ready"; shown: CaptureShown }
  | { type: "face-step"; shown: CaptureShown }
  | { type: "face-sent" }
  | { type: "face-cancel" }
  | { type: "code-sent" }
  | { type: "slow" }
  | { type: "answered"; answer: PunchAnswer }
  | { type: "failed"; code: string }
  | { type: "screen-over" };

// Screens where the person is waiting for something that can go wrong.
const FAILS_FROM = new Set<AttendanceScreen["name"]>([
  "checking",
  "get-ready",
  "face-guide",
  "face-challenge",
  "code-entry",
]);

export const INITIAL_SCREEN: AttendanceScreen = { name: "starting" };

export function nextScreen(screen: AttendanceScreen, event: AttendanceEvent): AttendanceScreen {
  switch (event.type) {
    case "camera-ready":
      return screen.name === "starting" || screen.name === "needs-tap"
        ? { name: "scanning", notACard: false }
        : screen;
    case "camera-needs-tap":
      return screen.name === "starting" ? { name: "needs-tap" } : screen;
    case "camera-failed":
      return { name: "camera-problem", code: event.code };
    case "not-a-card":
      return screen.name === "scanning" ? { name: "scanning", notACard: true } : screen;
    case "not-a-card-over":
      return screen.name === "scanning" ? { name: "scanning", notACard: false } : screen;
    case "card-read":
      return screen.name === "scanning" ? { name: "get-ready", payload: event.payload } : screen;
    case "photo-taken":
      return screen.name === "get-ready" ? { name: "checking", slow: false } : screen;
    case "photo-cancelled":
      return screen.name === "get-ready" ? { name: "scanning", notACard: false } : screen;
    case "face-start":
      return screen.name === "scanning" ? { name: "face-guide", timedOut: false } : screen;
    case "face-guide-timeout":
      return screen.name === "face-guide" ? { name: "face-guide", timedOut: true } : screen;
    case "face-retry":
      // From the "could not see your face" text or from a result that allows another try.
      return screen.name === "face-guide" ||
        screen.name === "result" ||
        (screen.name === "failed" && canTryAgainAfterFailure(screen.code))
        ? { name: "face-guide", timedOut: false }
        : screen;
    case "face-ready":
      return screen.name === "face-guide" ? { name: "face-challenge", shown: event.shown } : screen;
    case "face-step":
      return screen.name === "face-challenge"
        ? { name: "face-challenge", shown: event.shown }
        : screen;
    case "face-sent":
      return screen.name === "face-challenge"
        ? { name: "checking", slow: false, via: "face" }
        : screen;
    case "code-sent":
      return screen.name === "code-entry" ? { name: "checking", slow: false, via: "code" } : screen;
    case "face-cancel":
      return screen.name === "face-guide" ||
        screen.name === "face-challenge" ||
        screen.name === "code-entry"
        ? { name: "scanning", notACard: false }
        : screen;
    case "slow":
      return screen.name === "checking" ? { ...screen, slow: true } : screen;
    case "answered":
      if (screen.name !== "checking") return screen;
      if (event.answer.decision === "needs_code" && event.answer.code_entry) {
        return {
          name: "code-entry",
          entry: event.answer.code_entry,
          wrong: event.answer.reason_code === "CODE_NOT_MATCHED",
        };
      }
      return { name: "result", answer: event.answer, ...(screen.via ? { via: screen.via } : {}) };
    case "failed":
      return FAILS_FROM.has(screen.name) ? { name: "failed", code: event.code } : screen;
    case "screen-over":
      return screen.name === "result" || screen.name === "failed"
        ? { name: "scanning", notACard: false }
        : screen;
  }
}

// A result with a "Try again" button stays a little longer: time to read it and decide.
export const RETRY_SECONDS = 10;

/** True on the screens of a face punch: they use the camera meant for photos and pause scanning. */
export function isFaceScreen(screen: AttendanceScreen): boolean {
  return (
    screen.name === "face-guide" ||
    screen.name === "face-challenge" ||
    (screen.name === "checking" && screen.via === "face")
  );
}

/** How long a result or failure stays before the kiosk scans again (seconds). */
export function secondsOnScreen(
  screen: AttendanceScreen,
  settings: { result_seconds: number; reject_seconds: number },
): number | null {
  if (screen.name === "failed") {
    return canTryAgainAfterFailure(screen.code) ? RETRY_SECONDS : settings.reject_seconds;
  }
  if (screen.name !== "result") return null;
  if (canTryAgain(screen.answer)) return RETRY_SECONDS;
  const kind = resultKind(screen.answer);
  // Rejections and the self test stay longer (time to read); IN, OUT and "already" are quick.
  return kind === "rejected" || kind === "self-test"
    ? settings.reject_seconds
    : settings.result_seconds;
}
