// Which screen the kiosk shows, as a small state machine (spec M2 §4.1 to §4.5).
//
//   starting -> scanning -> get-ready -> checking -> result -> scanning
//   (get-ready: the card is read and the worker gets time to look at the camera; "I am ready"
//    or the end of the time takes the photo, "Cancel" goes back to scanning)
//   checking or get-ready -> failed (no internet...) -> scanning
//   starting -> needs-tap ("Start camera") / camera-problem (blocked, not found)
//
// Only one punch at a time: a card is accepted only on the scanning screen. Every other
// event that does not fit the current screen is ignored.
import type { CameraProblem } from "./camera";
import { type PunchAnswer, resultKind } from "./punch-types";

export type AttendanceScreen =
  | { name: "starting" }
  | { name: "needs-tap" }
  | { name: "camera-problem"; code: CameraProblem | "BROWSER_NOT_SUPPORTED" }
  | { name: "scanning"; notACard: boolean }
  | { name: "get-ready"; payload: string }
  | { name: "checking"; slow: boolean }
  | { name: "result"; answer: PunchAnswer }
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
  | { type: "slow" }
  | { type: "answered"; answer: PunchAnswer }
  | { type: "failed"; code: string }
  | { type: "screen-over" };

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
    case "slow":
      return screen.name === "checking" ? { name: "checking", slow: true } : screen;
    case "answered":
      return screen.name === "checking" ? { name: "result", answer: event.answer } : screen;
    case "failed":
      return screen.name === "checking" || screen.name === "get-ready"
        ? { name: "failed", code: event.code }
        : screen;
    case "screen-over":
      return screen.name === "result" || screen.name === "failed"
        ? { name: "scanning", notACard: false }
        : screen;
  }
}

/** How long a result or failure stays before the kiosk scans again (seconds). */
export function secondsOnScreen(
  screen: AttendanceScreen,
  settings: { result_seconds: number; reject_seconds: number },
): number | null {
  if (screen.name === "failed") return settings.reject_seconds;
  if (screen.name !== "result") return null;
  const kind = resultKind(screen.answer);
  // Rejections and the self test stay longer (time to read); IN, OUT and "already" are quick.
  return kind === "rejected" || kind === "self-test"
    ? settings.reject_seconds
    : settings.result_seconds;
}
