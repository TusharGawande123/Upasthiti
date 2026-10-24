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
  "SERVER_NO_ANSWER",
  "INTERNAL_ERROR",
  "TOO_MANY_REQUESTS",
  "PAYLOAD_TOO_LARGE",
  // Face punch (spec M3 §9): each has its own short spoken line.
  "NO_FACE",
  "MULTIPLE_FACES",
  "FACE_TOO_SMALL",
  "FACE_QUALITY_LOW",
  "LIVENESS_FAILED",
  "FACE_INCONSISTENT",
  "CHALLENGE_EXPIRED",
  "SPOOF_SUSPECTED",
  "CHALLENGE_INVALID",
  "FRAMES_INVALID",
  "FACE_NOT_RECOGNISED",
  "CODE_ENTRY_EXPIRED",
  "FACE_SERVICE_UNAVAILABLE",
  "FACE_SERVICE_BUSY",
  "FACE_NOT_CONFIGURED",
]);

// A face rejection after a face punch says "your face"; WRONG_PLANT has its own face wording.
export function rejectionTextCode(code: string, viaFace: boolean): string {
  return viaFace && code === "WRONG_PLANT" ? "WRONG_PLANT_FACE" : code;
}

function rejectLine(code: string, viaFace = false): string {
  const spoken = SPOKEN_CODES.has(code) ? rejectionTextCode(code, viaFace) : "INTERNAL_ERROR";
  return `kiosk.punch.${spoken}.voice`;
}

export type Feedback = { tone: Tone; voiceKey: string | null };

export function feedbackFor(screen: AttendanceScreen): Feedback | null {
  if (screen.name === "get-ready") return { tone: "tick", voiceKey: "kiosk.voice.getReady" };
  // A short tick each time the head-turn picture or the next instruction changes (spec §4.3).
  if (screen.name === "face-challenge") return { tone: "tick", voiceKey: null };
  if (screen.name === "code-entry") return { tone: "already", voiceKey: "kiosk.voice.needCode" };
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
    case "needs-code":
      return null; // the code pad speaks for it (see code-entry above)
    case "rejected":
      return {
        tone: "reject",
        voiceKey: rejectLine(answer.reason_code ?? "INTERNAL_ERROR", screen.via !== undefined),
      };
  }
}
