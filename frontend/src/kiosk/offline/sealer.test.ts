// The gate's sealing must give exactly what the server opens (M4 spec §8.2, AC-13). The same
// test vector file is read by backend/tests/test_offline_crypto_and_time.py.
import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "../device-key";
import { evidenceBinding, sealEvidence, sealWith } from "./sealer";
import vector from "./test-vector.json";

async function importPair(): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64UrlToBytes(vector.one_time_private_key_pkcs8),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(vector.one_time_public_key),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  return { privateKey, publicKey };
}

const binding = evidenceBinding(vector.kiosk_id, vector.client_punch_id, "qr", vector.key_id);

describe("sealing evidence for the server", () => {
  it("makes the same bytes as the server side for fixed keys and nonce", async () => {
    const sealed = await sealWith(
      await importPair(),
      base64UrlToBytes(vector.nonce),
      vector.server_public_key,
      vector.key_id,
      new TextEncoder().encode(vector.plaintext),
      binding,
    );

    expect(sealed).toEqual(vector.evidence);
  });

  it("uses a new one-time key and nonce for every punch, and hides the text", async () => {
    const plain = new TextEncoder().encode("a card text and a photo");
    const first = await sealEvidence(vector.server_public_key, "A", plain, binding);
    const second = await sealEvidence(vector.server_public_key, "A", plain, binding);

    expect(first.ephemeral_public_key).not.toBe(second.ephemeral_public_key);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain("a card text");
  });

  it("ties the binding to the kiosk, the punch, the method and the key id", () => {
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    expect(text(binding)).toBe(`${vector.kiosk_id}|${vector.client_punch_id}|qr|A`);
  });
});
