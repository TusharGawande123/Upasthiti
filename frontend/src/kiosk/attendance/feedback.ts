// Which tone and which spoken line go with each screen (spec M2 §4.4, §7 rule 13). The tone
// plays first; the line follows about 300 ms later. Lines are translation keys, never names.
import type { AttendanceScreen } from "./attendance-machine";
import { resultKind } from "./punch-types";
import type { Tone } from "./sound";

export const VOICE_DELAY_MS = 300;

// Codes with their own spoken line; others use the general "something went wrong" line.
const SPOKEN_CODES = new Set([
  "QR_REVOKED",
  "QR_EXPIRED",
  "QR_NOT_YET_VALID",
  "WRONG_PLANT",
  "EMPLOYEE_NOT_QR",
  "EMPLOYEE_INACTIVE",
  "QR_SIGNATURE_INVALID",
  "QR_FORMAT_INVALID",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_INVALID",
  "QR_SIGNING_NOT_CONFIGURED",
  "NETWORK_OFFLINE",
  "INTERNAL_ERROR",
  "TOO_MANY_REQUESTS",
  "PAYLOAD_TOO_LARGE",
]);

function rejectLine(code: string): string {
  return `kiosk.punch.${SPOKEN_CODES.has(code) ? code : "INTERNAL_ERROR"}.voice`;
}

export type Feedback = { tone: Tone; voiceKey: string | null };

export function feedbackFor(screen: AttendanceScreen): Feedback | null {
  if (screen.name === "card-read") return { tone: "tick", voiceKey: null };
  if (screen.name === "failed") return { tone: "reject", voiceKey: rejectLine(screen.code) };
  if (screen.name !== "result") return null;
  const { answer } = screen;
  switch (resultKind(answer)) {
    case "in":
      return { tone: "success", voiceKey: "kiosk.voice.in" };
    case "out":
      return { tone: "success", voiceKey: "kiosk.voice.out" };
    case "self-test":
      return { tone: "success", voiceKey: "kiosk.voice.selfTest" };
    case "already":
      return {
        tone: "already",
        voiceKey:
          answer.details.last_direction === "out"
            ? "kiosk.voice.alreadyOut"
            : "kiosk.voice.alreadyIn",
      };
    case "rejected":
      return { tone: "reject", voiceKey: rejectLine(answer.reason_code ?? "INTERNAL_ERROR") };
  }
}
