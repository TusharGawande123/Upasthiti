// Locks the evidence of an offline punch so that ONLY the server can open it (M4 spec §8.2).
// Must match backend/app/core/offline_crypto.py exactly:
//   a new ECDH P-256 key pair per punch (its private half is never stored)
//   -> shared secret with the server's public key
//   -> HKDF-SHA256 (salt = this one-time public key, info = HKDF_INFO) -> AES-256-GCM key
//   -> encrypt with a random 12-byte nonce, bound to "kiosk id|punch id|method|key id".
// The gate cannot open its own queue afterwards: the photo, card text, code and face pictures
// are never stored in a readable form.
import { base64UrlToBytes, bytesToBase64Url } from "../device-key";

const HKDF_INFO = new TextEncoder().encode("upasthiti-offline-evidence-v1");
const NONCE_BYTES = 12;

export type SealedEvidence = {
  key_id: string;
  ephemeral_public_key: string;
  nonce: string;
  ciphertext: string;
};

export function evidenceBinding(
  kioskId: string,
  clientPunchId: string,
  method: "qr" | "face",
  keyId: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${kioskId}|${clientPunchId}|${method}|${keyId}`);
}

/** Seals with a fresh one-time key and nonce (what the gate does). */
export async function sealEvidence(
  serverPublicKey: string,
  keyId: string,
  plaintext: Uint8Array<ArrayBuffer>,
  binding: Uint8Array<ArrayBuffer>,
): Promise<SealedEvidence> {
  const oneTime = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return sealWith(oneTime, nonce, serverPublicKey, keyId, plaintext, binding);
}

/** The sealing itself, with the one-time key and nonce given (the shared test vector uses it). */
export async function sealWith(
  oneTime: CryptoKeyPair,
  nonce: Uint8Array<ArrayBuffer>,
  serverPublicKey: string,
  keyId: string,
  plaintext: Uint8Array<ArrayBuffer>,
  binding: Uint8Array<ArrayBuffer>,
): Promise<SealedEvidence> {
  const serverKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(serverPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeralPoint = new Uint8Array(await crypto.subtle.exportKey("raw", oneTime.publicKey));
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverKey },
    oneTime.privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: ephemeralPoint, info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: binding },
    aesKey,
    plaintext,
  );
  return {
    key_id: keyId,
    ephemeral_public_key: bytesToBase64Url(ephemeralPoint),
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}
