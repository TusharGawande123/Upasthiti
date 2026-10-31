// The server's answers that the kiosk attendance screens use (spec M2 §5.2, M3 §5.2, M4 §5.1).
import type { KioskLocationSettings } from "../location/gate-location";
import type { KioskOfflineSettings } from "../offline/offline-queue";
import type { TimeAnchor } from "../offline/time-anchor";

/** After a face punch the server may ask for the employee code (`needs_code`, spec M3 §4.5). */
export type CodeEntry = { token: string; expires_at: string; tries_left: number };

/**
 * Before an OUT that is earlier than the shift end the server stores nothing and asks first
 * (`needs_confirmation`, M5 decision 0036 line 9). Agree sends `token` back; Cancel sends nothing.
 */
export type EarlyOutPrompt = {
  token: string;
  /** The id the confirmation must use: the token belongs to it. */
  client_punch_id: string;
  expires_at: string;
  /** "before_half": the half shift is not complete; "before_end": only the full shift is left. */
  tier: "before_half" | "before_end";
  half_remaining_min: number | null;
  half_at: string | null;
  full_remaining_min: number;
  shift_end: string;
};

export type PunchAnswer = {
  punch_id: string | null;
  decision: "accepted" | "rejected" | "self_test" | "needs_code" | "needs_confirmation";
  direction: "in" | "out" | null;
  employee: { display_name: string; employee_code: string } | null;
  server_time: string;
  reason_code: string | null;
  message_key: string;
  voice_key: string;
  details: {
    kiosk_name: string;
    last_direction?: "in" | "out" | null;
    last_punch_at?: string | null;
    out_allowed_from?: string | null;
    /** Face rejections where trying again can help (spec M3 §4.6). */
    retry_allowed?: boolean | null;
    /** M4 self test: "ok", or the location rule's code ("Location ✓" / "Location ✗"). */
    location_check?: string | null;
  };
  code_entry?: CodeEntry | null;
  /** Only with decision "needs_confirmation". */
  early_out?: EarlyOutPrompt | null;
  /** M5: numbers made by the server, only for an online accepted punch and only when switched on. */
  gate_lines?: { late_minutes: number | null; month_days_present: number | null } | null;
  /** M4: the server's time for the offline clock; also remembered by the signer. */
  time_anchor?: TimeAnchor | null;
};

export type KioskNotice = {
  id: string;
  text: string;
  level: "normal" | "important";
  ends_at: string;
};

/** What the gate needs to offer and run a face punch (spec M3 §5.2). */
export type KioskFaceSettings = {
  available: boolean;
  state: "ready" | "loading" | "off";
  /** At least one enrolled face employee at this plant; without one the button is hidden. */
  enabled_for_plant: boolean;
  challenge_seconds: number;
  code_entry_seconds: number;
  min_yaw_degrees: number;
  /** Up to 3 common starts of the plant's employee codes, e.g. "EMP-" (decision 0019). */
  code_prefixes: string[];
};

export type KioskScreenSettings = {
  voice_enabled: boolean;
  sound_enabled: boolean;
  result_seconds: number;
  reject_seconds: number;
  /** Time to get ready after the card is read, before the photo is taken. */
  photo_ready_seconds: number;
  snapshot_retention_days: number;
  dark_threshold: number;
  face: KioskFaceSettings;
  /** M4: how the gate judges its location, and the plant's fence (absent on an older server). */
  location?: KioskLocationSettings;
  /** M4: what the gate needs to save punches while offline (absent on an older server). */
  offline?: KioskOfflineSettings;
};

/** GET /kiosk/me: the heartbeat answer. */
export type KioskMe = {
  kiosk_id: string;
  kiosk_name: string;
  status: string;
  plant: { id: string; name: string; code: string };
  server_time: string;
  notices: KioskNotice[];
  kiosk_settings: KioskScreenSettings;
  time_anchor?: TimeAnchor | null;
};

/** Used until the first heartbeat answers (the server defaults, spec §7 rule 12). */
export const DEFAULT_SCREEN_SETTINGS: KioskScreenSettings = {
  voice_enabled: true,
  sound_enabled: true,
  result_seconds: 4,
  reject_seconds: 6,
  photo_ready_seconds: 20,
  snapshot_retention_days: 60,
  dark_threshold: 40,
  face: {
    available: false,
    state: "off",
    enabled_for_plant: false,
    challenge_seconds: 10,
    code_entry_seconds: 90,
    min_yaw_degrees: 18,
    code_prefixes: [],
  },
};

// "Already punched" is not really a no: the person is checked in, they only scanned too soon.
export const ALREADY_PUNCHED_CODES = ["COOLDOWN_ACTIVE", "OUT_TOO_SOON"];

export type ResultKind = "in" | "out" | "already" | "rejected" | "self-test" | "needs-code";

export function resultKind(answer: PunchAnswer): ResultKind {
  if (answer.decision === "self_test") return "self-test";
  if (answer.decision === "needs_code") return "needs-code";
  if (answer.decision === "accepted") return answer.direction === "out" ? "out" : "in";
  if (answer.reason_code && ALREADY_PUNCHED_CODES.includes(answer.reason_code)) return "already";
  return "rejected";
}

/** Failures the device itself makes where another try can help (the head turn was too slow). */
export function canTryAgainAfterFailure(code: string): boolean {
  return code === "CHALLENGE_EXPIRED";
}

/** The one-word rule for the "Try again" button: the server says whether a retry can help. */
export function canTryAgain(answer: PunchAnswer): boolean {
  return resultKind(answer) === "rejected" && answer.details.retry_allowed === true;
}
