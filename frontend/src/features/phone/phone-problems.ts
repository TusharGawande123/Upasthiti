// What a phone problem looks like (design gate P2, screen 6): one table from the code the server
// (or the phone itself) gives to the look of the card. The words are in the translation file
// under `phone.punch.<CODE>.title|message|next`; this file only chooses icon and colour.
// Retry hints say "Please try again."; refusals end with "Please visit the plant office."
import {
  CircleAlert,
  Clock3,
  CloudOff,
  Hourglass,
  type LucideIcon,
  MapPinOff,
  OctagonX,
  RotateCw,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { PhoneLocationError } from "./phone-camera-hooks";

export type ProblemLook = {
  code: string;
  icon: LucideIcon;
  tone: "amber" | "red" | "blue" | "grey";
  /** True when "Try again" is offered (a camera, location or timing problem). */
  retry: boolean;
};

const RETRY = new Set([
  "NO_FACE",
  "MULTIPLE_FACES",
  "FACE_TOO_SMALL",
  "FACE_QUALITY_LOW",
  "LIVENESS_FAILED",
  "FACE_INCONSISTENT",
  "CHALLENGE_EXPIRED",
  "CHALLENGE_INVALID",
  "FRAMES_INVALID",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_INVALID",
  "PAYLOAD_TOO_LARGE",
  "LOCATION_REQUIRED",
  "PHONE_LOCATION_DENIED",
  "GPS_ACCURACY_TOO_LOW",
  "GATE_CODE_EXPIRED",
  "NOT_A_GATE_CODE",
  "NETWORK_OFFLINE",
  "INTERNAL_ERROR",
]);
const WAIT = new Set(["FACE_SERVICE_BUSY", "FACE_SERVICE_UNAVAILABLE", "TOO_MANY_REQUESTS"]);
const NOTICE = new Set(["COOLDOWN_ACTIVE", "OUT_TOO_SOON", "SHIFT_ALREADY_CLOSED"]);
const KNOWN = new Set([
  ...RETRY,
  ...WAIT,
  ...NOTICE,
  "SPOOF_SUSPECTED",
  "FACE_NOT_RECOGNISED",
  "WRONG_PLANT",
  "OUTSIDE_GEOFENCE",
  "GEOFENCE_NOT_SET",
  "GATE_CODE_INVALID",
  "EMPLOYEE_NOT_FACE",
  "EMPLOYEE_NOT_QR",
  "PROOF_FAILED",
  "FACE_NOT_CONFIGURED",
]);

export function lookFor(rawCode: string): ProblemLook {
  const code = KNOWN.has(rawCode) ? rawCode : "INTERNAL_ERROR";
  if (code === "NETWORK_OFFLINE") return { code, icon: CloudOff, tone: "grey", retry: true };
  if (
    code === "OUTSIDE_GEOFENCE" ||
    code === "PHONE_LOCATION_DENIED" ||
    code === "LOCATION_REQUIRED"
  ) {
    return {
      code,
      icon: MapPinOff,
      tone: RETRY.has(code) ? "amber" : "red",
      retry: RETRY.has(code),
    };
  }
  if (WAIT.has(code)) return { code, icon: Hourglass, tone: "blue", retry: true };
  if (NOTICE.has(code)) return { code, icon: Clock3, tone: "grey", retry: false };
  if (RETRY.has(code)) return { code, icon: RotateCw, tone: "amber", retry: true };
  return {
    code,
    icon: code === "INTERNAL_ERROR" ? CircleAlert : OctagonX,
    tone: "red",
    retry: false,
  };
}

/** The code to show for anything a phone step can throw. */
export function codeOfFailure(error: unknown): string {
  if (error instanceof PhoneLocationError) return error.code;
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return "NETWORK_OFFLINE";
    return error.code;
  }
  if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}
