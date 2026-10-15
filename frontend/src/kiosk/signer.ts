// Signs every kiosk request (spec §7 rule 6). The server checks the signature with the public
// key it stored at pairing, so a stolen kiosk id alone is useless.
//
// The signed text (joined by newlines) must match backend/app/modules/kiosks/crypto.py:
//   METHOD, PATH with query, SHA-256 of the body (hex), nonce, counter
// WebCrypto gives the signature as raw r‖s bytes, which is what the server expects (base64url).
import { apiSend } from "@/lib/api-client";
import { bytesToBase64Url } from "./device-key";
import { loadDevice, takeNextCounter } from "./device-store";

const API_PREFIX = "/api/v1";
const NONCE_BYTES = 16;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(new Uint8Array(digest));
}

export type SignedHeaders = {
  "X-Kiosk-Id": string;
  "X-Kiosk-Nonce": string;
  "X-Kiosk-Counter": string;
  "X-Kiosk-Signature": string;
};

/** Builds the four signature headers for one request. */
export async function signRequest(
  method: string,
  pathWithQuery: string,
  bodyText: string,
): Promise<SignedHeaders> {
  const device = await loadDevice();
  if (!device) throw new Error("This device is not paired.");

  const nonce = toHex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
  const counter = await takeNextCounter();
  const message = [
    method.toUpperCase(),
    pathWithQuery,
    await sha256Hex(bodyText),
    nonce,
    String(counter),
  ].join("\n");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    device.privateKey,
    encoder.encode(message),
  );

  return {
    "X-Kiosk-Id": device.paired.kioskId,
    "X-Kiosk-Nonce": nonce,
    "X-Kiosk-Counter": String(counter),
    "X-Kiosk-Signature": bytesToBase64Url(new Uint8Array(signature)),
  };
}

/** Sends one signed request to the backend. `path` is relative to /api/v1. */
export async function signedRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  // The body text signed here must be exactly the text sent, so the server's hash matches.
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const headers = await signRequest(method, `${API_PREFIX}${path}`, bodyText);
  return apiSend<T>({ method, path, body, headers });
}
