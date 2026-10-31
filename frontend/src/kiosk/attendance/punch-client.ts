// Sending one punch to the server (spec M2 §4.3, §7 rule 7; M3 §5.1, §5.2): a card punch, a face
// punch (challenge first, then the frames) and the employee code typed after "we could not be
// sure it is you".
//
// - Each scan gets its own random id. A retry reuses it, so the server never counts a scan twice.
// - One automatic retry for a lost connection, a server error or NONCE_REUSED (a new signature
//   is made for every attempt).
// - After 5 seconds without an answer the screen says the server is starting (Render wakes up);
//   after 60 seconds the kiosk gives up. It cannot know whether the server saved the punch
//   meanwhile, so it says "not sure": a new scan then answers "already punched" if it was saved.
import { ApiError } from "@/lib/api-client";
import type { LocationReport } from "../location/gate-location";
import { signedRequest } from "../signer";
import type { EarlyOutPrompt, PunchAnswer } from "./punch-types";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
export const SLOW_AFTER_MS = 5_000;
export const GIVE_UP_AFTER_MS = 60_000;

export type PunchBody = {
  client_punch_id: string;
  method: "qr";
  qr_payload: string;
  snapshot_jpeg: string;
  device_time: string;
  app_version: string;
  /** M4: the gate's reading; the server checks it against the fence on every punch. */
  location: LocationReport | null;
};

/** One picture of the face punch: the first is "frontal", the others "turn" or "frontal". */
export type FaceFrame = { role: "frontal" | "turn"; jpeg: string };

export type FacePunchBody = {
  client_punch_id: string;
  method: "face";
  challenge_nonce: string;
  frames: FaceFrame[];
  device_time: string;
  app_version: string;
  location: LocationReport | null;
};

export type CodeBody = {
  client_punch_id: string;
  code_entry_token: string;
  employee_code: string;
};

export type PunchOutcome =
  | { kind: "answer"; answer: PunchAnswer }
  | { kind: "failed"; code: string };

/** The head turn the server asks for (spec M3 §5.1; two steps are the F-43 setting). */
export type ChallengeName = "turn_left" | "turn_right" | "left_then_right" | "right_then_left";

export type Challenge = {
  challenge_nonce: string;
  challenge: ChallengeName;
  expires_at: string;
  server_time: string;
  capture: {
    min_frames: number;
    max_frames: number;
    max_width: number;
    max_height: number;
    max_frame_bytes: number;
    min_yaw_degrees: number;
  };
};

export type ChallengeOutcome =
  | { kind: "challenge"; challenge: Challenge }
  | { kind: "failed"; code: string };

// Server codes the kiosk shows by name; everything else is a general "something went wrong".
const SHOWN_CODES = new Set([
  "TOO_MANY_REQUESTS",
  "PAYLOAD_TOO_LARGE",
  "DEVICE_REVOKED",
  "DEVICE_SIGNATURE_INVALID",
  "QR_SIGNING_NOT_CONFIGURED",
  "FACE_SERVICE_UNAVAILABLE",
  "FACE_SERVICE_BUSY",
  "FACE_NOT_CONFIGURED",
]);

function worthRetrying(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === "NETWORK_ERROR" || error.code === "NONCE_REUSED") return true;
  if (SHOWN_CODES.has(error.code)) return false; // a busy face service is not retried at once
  return error.status >= 500 || error.code === "HTTP_ERROR";
}

function failureCode(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return "NETWORK_OFFLINE";
    if (SHOWN_CODES.has(error.code)) return error.code;
  }
  return "INTERNAL_ERROR";
}

export type SendPunch = (body: PunchBody) => Promise<PunchAnswer>;

const sendSigned: SendPunch = (body) => signedRequest<PunchAnswer>("POST", "/punch/kiosk", body);

type DeliverOptions = { onSlow?: () => void };

// Sends once, retries once, gives up after a minute; tells the screen when the answer is slow.
async function deliver<Answer>(
  send: () => Promise<Answer>,
  options: DeliverOptions,
): Promise<{ kind: "answer"; answer: Answer } | { kind: "failed"; code: string }> {
  const slowTimer = setTimeout(() => options.onSlow?.(), SLOW_AFTER_MS);
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<{ kind: "failed"; code: string }>((resolve) => {
    giveUpTimer = setTimeout(
      () => resolve({ kind: "failed", code: "SERVER_NO_ANSWER" }),
      GIVE_UP_AFTER_MS,
    );
  });

  const attempt = async (): Promise<
    { kind: "answer"; answer: Answer } | { kind: "failed"; code: string }
  > => {
    try {
      return { kind: "answer", answer: await send() };
    } catch (firstError) {
      if (!worthRetrying(firstError)) return { kind: "failed", code: failureCode(firstError) };
      try {
        return { kind: "answer", answer: await send() };
      } catch (secondError) {
        return { kind: "failed", code: failureCode(secondError) };
      }
    }
  };

  try {
    return await Promise.race([attempt(), giveUp]);
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(giveUpTimer);
  }
}

/** Agree at the early-OUT alert: the server stores the OUT now (decision 0036 line 9). */
export async function sendEarlyOutConfirm(
  input: {
    prompt: EarlyOutPrompt;
    /** A card punch sends its photo again; the first request stored nothing. */
    snapshotBase64: string | null;
    location: LocationReport | null;
  },
  options: { onSlow?: () => void } = {},
): Promise<PunchOutcome> {
  const body = {
    client_punch_id: input.prompt.client_punch_id,
    token: input.prompt.token,
    snapshot_jpeg: input.snapshotBase64,
    device_time: new Date().toISOString(),
    app_version: APP_VERSION,
    location: input.location,
  };
  return deliver(
    () => signedRequest<PunchAnswer>("POST", "/punch/kiosk/early-out/confirm", body),
    options,
  );
}

export async function sendPunch(
  input: {
    qrPayload: string;
    snapshotBase64: string;
    location: LocationReport | null;
    /** M4: made by the caller, so a punch queued after a failed send keeps the same id. */
    clientPunchId?: string;
  },
  options: { onSlow?: () => void; send?: SendPunch } = {},
): Promise<PunchOutcome> {
  const send = options.send ?? sendSigned;
  const body: PunchBody = {
    client_punch_id: input.clientPunchId ?? crypto.randomUUID(),
    method: "qr",
    qr_payload: input.qrPayload,
    snapshot_jpeg: input.snapshotBase64,
    device_time: new Date().toISOString(),
    app_version: APP_VERSION,
    location: input.location,
  };
  return deliver(() => send(body), options);
}

/** Asks for a new head-turn challenge. It is asked only once the person's face is ready. */
export async function requestChallenge(
  options: { send?: () => Promise<Challenge> } = {},
): Promise<ChallengeOutcome> {
  const send =
    options.send ??
    (() => signedRequest<Challenge>("POST", "/punch/challenge", { app_version: APP_VERSION }));
  const outcome = await deliver(send, {});
  return outcome.kind === "answer"
    ? { kind: "challenge", challenge: outcome.answer }
    : { kind: "failed", code: outcome.code };
}

export async function sendFacePunch(
  input: { challengeNonce: string; frames: FaceFrame[]; location: LocationReport | null },
  options: { onSlow?: () => void; send?: (body: FacePunchBody) => Promise<PunchAnswer> } = {},
): Promise<PunchOutcome> {
  const send =
    options.send ??
    ((body: FacePunchBody) => signedRequest<PunchAnswer>("POST", "/punch/kiosk", body));
  const body: FacePunchBody = {
    client_punch_id: crypto.randomUUID(),
    method: "face",
    challenge_nonce: input.challengeNonce,
    frames: input.frames,
    device_time: new Date().toISOString(),
    app_version: APP_VERSION,
    location: input.location,
  };
  return deliver(() => send(body), options);
}

/** The employee code typed on the pad. Each try gets its own id (spec M3 §5.2). */
export async function sendEmployeeCode(
  input: { token: string; code: string },
  options: { onSlow?: () => void; send?: (body: CodeBody) => Promise<PunchAnswer> } = {},
): Promise<PunchOutcome> {
  const send =
    options.send ??
    ((body: CodeBody) => signedRequest<PunchAnswer>("POST", "/punch/kiosk/code", body));
  const body: CodeBody = {
    client_punch_id: crypto.randomUUID(),
    code_entry_token: input.token,
    employee_code: input.code,
  };
  return deliver(() => send(body), options);
}
