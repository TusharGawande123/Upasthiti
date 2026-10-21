// Sending one card punch to the server (spec M2 §4.3, §7 rule 7).
//
// - Each scan gets its own random id. A retry reuses it, so the server never counts a scan twice.
// - One automatic retry for a lost connection, a server error or NONCE_REUSED (a new signature
//   is made for every attempt).
// - After 5 seconds without an answer the screen says the server is starting (Render wakes up);
//   after 60 seconds the kiosk gives up. It cannot know whether the server saved the punch
//   meanwhile, so it says "not sure": a new scan then answers "already punched" if it was saved.
import { ApiError } from "@/lib/api-client";
import { signedRequest } from "../signer";
import type { PunchAnswer } from "./punch-types";

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
};

export type PunchOutcome =
  | { kind: "answer"; answer: PunchAnswer }
  | { kind: "failed"; code: string };

// Server codes the kiosk shows by name; everything else is a general "something went wrong".
const SHOWN_CODES = new Set([
  "TOO_MANY_REQUESTS",
  "PAYLOAD_TOO_LARGE",
  "DEVICE_REVOKED",
  "DEVICE_SIGNATURE_INVALID",
  "QR_SIGNING_NOT_CONFIGURED",
]);

function worthRetrying(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === "NETWORK_ERROR" || error.code === "NONCE_REUSED") return true;
  if (SHOWN_CODES.has(error.code)) return false;
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

export async function sendPunch(
  input: { qrPayload: string; snapshotBase64: string },
  options: { onSlow?: () => void; send?: SendPunch } = {},
): Promise<PunchOutcome> {
  const send = options.send ?? sendSigned;
  const body: PunchBody = {
    client_punch_id: crypto.randomUUID(),
    method: "qr",
    qr_payload: input.qrPayload,
    snapshot_jpeg: input.snapshotBase64,
    device_time: new Date().toISOString(),
    app_version: APP_VERSION,
  };

  const slowTimer = setTimeout(() => options.onSlow?.(), SLOW_AFTER_MS);
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<PunchOutcome>((resolve) => {
    giveUpTimer = setTimeout(
      () => resolve({ kind: "failed", code: "SERVER_NO_ANSWER" }),
      GIVE_UP_AFTER_MS,
    );
  });

  const attempt = async (): Promise<PunchOutcome> => {
    try {
      return { kind: "answer", answer: await send(body) };
    } catch (firstError) {
      if (!worthRetrying(firstError)) return { kind: "failed", code: failureCode(firstError) };
      try {
        return { kind: "answer", answer: await send(body) };
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
