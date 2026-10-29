// The kiosk's key pair (spec §7 rule 6, AC-17). WebCrypto ECDSA on curve P-256.
// The private key is made non-extractable: it can sign, but cannot be exported or copied.
// Only the public key (SPKI, base64) is sent to the server, once, when pairing.

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

export type DeviceKeyPair = { privateKey: CryptoKey; publicKeySpki: string };

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createDeviceKey(): Promise<DeviceKeyPair> {
  // `false` = the private key can never be exported. The public key is always exportable.
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return { privateKey: pair.privateKey, publicKeySpki: bytesToBase64(new Uint8Array(spki)) };
}

/** Does this browser have what pairing needs (secure context, WebCrypto, storage, location)? */
export function browserCanPair(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator
  );
}
