// The server's answers that the kiosk attendance screens use (spec M2 §5.2).

export type PunchAnswer = {
  punch_id: string | null;
  decision: "accepted" | "rejected" | "self_test";
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
  };
};

export type KioskNotice = {
  id: string;
  text: string;
  level: "normal" | "important";
  ends_at: string;
};

export type KioskScreenSettings = {
  voice_enabled: boolean;
  sound_enabled: boolean;
  result_seconds: number;
  reject_seconds: number;
  snapshot_retention_days: number;
  dark_threshold: number;
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
};

/** Used until the first heartbeat answers (the server defaults, spec §7 rule 12). */
export const DEFAULT_SCREEN_SETTINGS: KioskScreenSettings = {
  voice_enabled: true,
  sound_enabled: true,
  result_seconds: 4,
  reject_seconds: 6,
  snapshot_retention_days: 60,
  dark_threshold: 40,
};

// "Already punched" is not really a no: the person is checked in, they only scanned too soon.
export const ALREADY_PUNCHED_CODES = ["COOLDOWN_ACTIVE", "OUT_TOO_SOON"];

export type ResultKind = "in" | "out" | "already" | "rejected" | "self-test";

export function resultKind(answer: PunchAnswer): ResultKind {
  if (answer.decision === "self_test") return "self-test";
  if (answer.decision === "accepted") return answer.direction === "out" ? "out" : "in";
  if (answer.reason_code && ALREADY_PUNCHED_CODES.includes(answer.reason_code)) return "already";
  return "rejected";
}
