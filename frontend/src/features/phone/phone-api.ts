// The calls and answer shapes of the phone pages (spec M4b §5.1 to §5.3). Every call goes to
// /api/v1/phone/*; the employee is told apart by the cookie `ups_phone`, never by a header.
import type { GateFence } from "@/kiosk/location/fence-distance";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

export type PunchMethod = "face" | "qr";

export type SignedIn = {
  employee: {
    code: string;
    name: string;
    plant: { code: string; name: string };
    punch_method: PunchMethod;
  };
  notice_required: boolean;
};

export type CaptureRules = {
  min_frames: number;
  max_frames: number;
  max_width: number;
  max_height: number;
  max_frame_bytes: number;
  min_yaw_degrees: number;
};

export type PasskeyItem = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export type PhoneMe = {
  employee: {
    code: string;
    name: string;
    first_name: string;
    plant: { id: string; code: string; name: string };
    punch_method: PunchMethod;
  };
  access: { outside_work_allowed: boolean; outside_work_until: string | null };
  notice: { required: boolean; version: string };
  ready: { face: boolean };
  passkeys: PasskeyItem[];
  today: {
    last_punch: { direction: "in" | "out"; time: string; channel: "kiosk" | "phone" } | null;
  };
  settings: {
    gps_accuracy_limit_m: number;
    location_max_age_seconds: number;
    challenge_seconds: number;
    photo_ready_seconds: number;
    capture: CaptureRules;
  };
  geofence: GateFence | null;
};

export type ChallengeName = "turn_left" | "turn_right" | "left_then_right" | "right_then_left";

export type PhoneChallenge = {
  challenge_nonce: string;
  challenge: ChallengeName;
  expires_at: string;
  server_time: string;
  capture: CaptureRules;
};

export type FaceProofChallenge = PhoneChallenge & { proof_id: string };

export type FaceFrame = { role: "frontal" | "turn"; jpeg: string };

export type PhoneLocation = { lat: number; lon: number; accuracy_m: number; age_s: number };

export type ProofAnswer = {
  proof_token: string;
  expires_at: string;
  employee: { code: string; first_name: string };
};

/** The alert before an OUT earlier than the shift end: same facts as the gate's alert. */
export type PhoneEarlyOutPrompt = {
  token: string;
  client_punch_id: string;
  expires_at: string;
  tier: "before_half" | "before_end";
  half_remaining_min: number | null;
  half_at: string | null;
  full_remaining_min: number;
  shift_end: string;
};

export type PhonePunchAnswer = {
  punch_id: string | null;
  decision: "accepted" | "rejected" | "needs_confirmation";
  early_out?: PhoneEarlyOutPrompt | null;
  reason_code: string | null;
  direction: "in" | "out" | null;
  punch_time: string;
  outside_plant: boolean;
  details: { retry_allowed?: boolean | null };
};

export type AttendanceDay = {
  date: string;
  status: string;
  first_in: string | null;
  last_out: string | null;
  worked_min: number;
  channels: ("phone" | "kiosk")[];
};

export type NoticeText = { version: string; language: string; text: string; text_sha256: string };

export const phoneApi = {
  me: () => apiGet<PhoneMe>("/phone/me"),
  login: (body: { employee_code: string; password: string }) =>
    apiPost<SignedIn>("/phone/login", body),
  logout: () => apiPost<void>("/phone/logout"),
  stop: () => apiPost<void>("/phone/stop", { confirm: true }),
  notice: (language: string) =>
    apiGet<NoticeText>(`/phone/notice?language=${encodeURIComponent(language)}`),
  acceptNotice: (body: { version: string; text_sha256: string; language: string }) =>
    apiPost<{ accepted_at: string }>("/phone/notice/accept", body),
  faceProofChallenge: (employeeCode: string) =>
    apiPost<FaceProofChallenge>("/phone/proof/face/challenge", { employee_code: employeeCode }),
  faceProof: (body: { proof_id: string; challenge_nonce: string; frames: FaceFrame[] }) =>
    apiPost<ProofAnswer>("/phone/proof/face", body),
  cardProof: (body: { qr_payload: string; location: PhoneLocation }) =>
    apiPost<ProofAnswer>("/phone/proof/card", body),
  setPassword: (body: { proof_token: string; new_password: string }) =>
    apiPost<SignedIn>("/phone/password", body),
  punchChallenge: () => apiPost<PhoneChallenge>("/phone/punch/challenge"),
  facePunch: (body: {
    client_punch_id: string;
    challenge_nonce: string;
    frames: FaceFrame[];
    location: PhoneLocation;
    app_version?: string;
  }) => apiPost<PhonePunchAnswer>("/phone/punch/face", body),
  gateCodePunch: (body: {
    client_punch_id: string;
    gate_code: string;
    photo_jpeg: string;
    location: PhoneLocation;
    app_version?: string;
  }) => apiPost<PhonePunchAnswer>("/phone/punch/gate-code", body),
  /** Agree at the early-OUT alert (the server decides the punch again). */
  earlyOutConfirm: (body: {
    client_punch_id: string;
    token: string;
    photo_jpeg: string | null;
    location: PhoneLocation;
    app_version?: string;
  }) => apiPost<PhonePunchAnswer>("/phone/punch/early-out/confirm", body),
  attendance: () => apiGet<{ days: AttendanceDay[] }>("/phone/attendance"),
  passkeyRegisterOptions: () =>
    apiPost<{ options: Record<string, unknown> }>("/phone/passkeys/register/options"),
  passkeyRegister: (credential: unknown) =>
    apiPost<{ id: string; label: string }>("/phone/passkeys/register", { credential }),
  passkeyRemove: (id: string) => apiDelete<void>(`/phone/passkeys/${id}`),
  passkeyLoginOptions: (employeeCode: string) =>
    apiPost<{ options: Record<string, unknown> }>("/phone/passkeys/login/options", {
      employee_code: employeeCode,
    }),
  passkeyLogin: (body: { employee_code: string; credential: unknown }) =>
    apiPost<SignedIn>("/phone/passkeys/login", body),
};

/** The phone sends the same app version the gate does (shown in the punch log). */
export const PHONE_APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
