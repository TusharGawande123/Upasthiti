// The kiosk's key and request signature (spec AC-16, AC-17): the private key cannot be
// exported, and what we sign can be verified with the public key exactly as the server does.
import { beforeEach, describe, expect, it } from "vitest";
import { createDeviceKey } from "./device-key";
import { forgetDevice, loadDevice, saveDevice } from "./device-store";
import { sha256Hex, signRequest } from "./signer";

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded =
    text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return base64ToBytes(padded);
}

const PAIRED = {
  kioskId: "11111111-2222-3333-4444-555555555555",
  kioskName: "Main gate",
  plantId: "p-1",
  plantCode: "K134",
  plantName: "Sheet Shapers (K-134)",
  accuracyM: 18,
};

beforeEach(async () => {
  await forgetDevice();
});

describe("device key", () => {
  it("makes a P-256 key whose private part cannot be exported", async () => {
    const key = await createDeviceKey();

    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key.privateKey)).rejects.toThrow();
    // The public key is a normal base64 SPKI that WebCrypto (and the server) can read back.
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(key.publicKeySpki),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    expect(publicKey.type).toBe("public");
  });
});

describe("request signature", () => {
  async function pairedDevice() {
    const key = await createDeviceKey();
    await saveDevice({
      privateKey: key.privateKey,
      publicKeySpki: key.publicKeySpki,
      paired: PAIRED,
      counter: 0,
    });
    return key;
  }

  it("signs METHOD, path, body hash, nonce and counter so the public key verifies it", async () => {
    const key = await pairedDevice();
    const body = JSON.stringify({ hello: "world" });

    const headers = await signRequest("post", "/api/v1/kiosk/ping?x=1", body);

    expect(headers["X-Kiosk-Id"]).toBe(PAIRED.kioskId);
    expect(headers["X-Kiosk-Counter"]).toBe("1");
    expect(headers["X-Kiosk-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    const message = [
      "POST",
      "/api/v1/kiosk/ping?x=1",
      await sha256Hex(body),
      headers["X-Kiosk-Nonce"],
      "1",
    ].join("\n");
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(key.publicKeySpki),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signature = base64UrlToBytes(headers["X-Kiosk-Signature"]);
    expect(signature.length).toBe(64); // raw r‖s, as the server expects
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      new TextEncoder().encode(message),
    );
    expect(valid).toBe(true);
  });

  it("uses a bigger counter and a new nonce every time", async () => {
    await pairedDevice();

    const first = await signRequest("GET", "/api/v1/kiosk/me", "");
    const second = await signRequest("GET", "/api/v1/kiosk/me", "");

    expect(Number(second["X-Kiosk-Counter"])).toBe(Number(first["X-Kiosk-Counter"]) + 1);
    expect(second["X-Kiosk-Nonce"]).not.toBe(first["X-Kiosk-Nonce"]);
    expect((await loadDevice())?.counter).toBe(2);
  });

  it("keeps counters apart when two requests are signed at the same moment", async () => {
    await pairedDevice();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => signRequest("GET", "/api/v1/kiosk/me", "")),
    );

    const counters = results.map((headers) => headers["X-Kiosk-Counter"]);
    expect(new Set(counters).size).toBe(5);
  });

  it("refuses to sign on a device that is not paired", async () => {
    await expect(signRequest("GET", "/api/v1/kiosk/me", "")).rejects.toThrow("not paired");
  });
});
