// Saving a punch while offline, and sending it later (M4 spec §7 rules 11 and 12; AC-8, AC-12,
// AC-19). The device storage is a fake IndexedDB; the server is a fake `fetch`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { createDeviceKey } from "../device-key";
import { forgetDevice, oldestQueued, queueSummary, saveDevice } from "../device-store";
import { itemStatement, type KioskOfflineSettings, saveOfflinePunch } from "./offline-queue";
import { syncOnce } from "./sync-runner";
import vector from "./test-vector.json";
import { forgetAnchorForTests, rememberAnchor } from "./time-anchor";

const KIOSK_ID = vector.kiosk_id;
const LOCATION = { lat: 19.85, lon: 75.25, accuracy_m: 10, age_s: 2 };
const SETTINGS: KioskOfflineSettings = {
  enabled: true,
  evidence_key_id: "A",
  evidence_public_key: vector.server_public_key,
  max_items: 2,
  max_mb: 200,
  max_hours: 72,
  cooldown_minutes: 2,
  challenge_steps: 1,
  sync_max_items: 20,
  sync_max_bytes: 1_048_576,
};

async function pairDevice() {
  const key = await createDeviceKey();
  await saveDevice({
    privateKey: key.privateKey,
    publicKeySpki: key.publicKeySpki,
    paired: {
      kioskId: KIOSK_ID,
      kioskName: "Main gate",
      plantId: "p-1",
      plantCode: "K134",
      plantName: "Sheet Shapers",
      accuracyM: 10,
    },
    counter: 5,
  });
  return key;
}

function save(clientPunchId: string, settings: KioskOfflineSettings | null = SETTINGS) {
  return saveOfflinePunch({
    clientPunchId,
    method: "qr",
    evidence: { qr_payload: "UPS1.A.C000123.SIG", snapshot_jpeg: "/9j/AA==" },
    location: LOCATION,
    settings: settings ?? undefined,
    offlineReady: true,
  });
}

beforeEach(async () => {
  await forgetDevice();
  forgetAnchorForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("saving a punch offline", () => {
  it("needs a server time anchor first and offline mode switched on", async () => {
    await pairDevice();

    expect(await save("p-1")).toBe("OFFLINE_NOT_READY"); // no anchor yet
    rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });
    expect(await save("p-1", { ...SETTINGS, enabled: false })).toBe("OFFLINE_NOT_READY");
    expect(await save("p-1", null)).toBe("OFFLINE_NOT_READY");
    expect((await queueSummary()).count).toBe(0);
  });

  it("stores only the locked form: no card text, no photo, no code", async () => {
    await pairDevice();
    rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });

    expect(await save("11111111-0000-0000-0000-000000000001")).toBe("OFFLINE_SAVED");

    const [saved] = await oldestQueued(10, 10_000_000);
    expect(saved?.counter).toBe(6); // the counter after the device's last request
    expect(saved?.signedItem).not.toContain("UPS1");
    expect(saved?.signedItem).not.toContain("/9j/AA");
    const item = JSON.parse(saved?.signedItem ?? "{}");
    expect(item).toMatchObject({ v: 1, method: "qr", location: LOCATION });
    expect(item.time.anchor.token).toBe("t");
    expect(item.time.same_session).toBe(true);
    expect(item.evidence.key_id).toBe("A");
  });

  it("signs the item text so the server can check the very text that was signed", async () => {
    const key = await pairDevice();
    rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });
    await save("11111111-0000-0000-0000-000000000002");
    const [saved] = await oldestQueued(10, 10_000_000);
    if (!saved) throw new Error("nothing was saved");

    const statement = await itemStatement(KIOSK_ID, saved.counter, saved.signedItem);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(key.publicKeySpki), (c) => c.charCodeAt(0)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const raw = Uint8Array.from(
      atob(`${saved.signature.replaceAll("-", "+").replaceAll("_", "/")}==`),
      (c) => c.charCodeAt(0),
    );
    const good = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      raw,
      new TextEncoder().encode(statement),
    );
    const edited = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      raw,
      new TextEncoder().encode(
        await itemStatement(KIOSK_ID, saved.counter, `${saved.signedItem} `),
      ),
    );
    expect(good).toBe(true);
    expect(edited).toBe(false);
  });

  it("refuses when the queue is full or the device has too little storage", async () => {
    await pairDevice();
    rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });
    await save("a");
    await save("b");

    expect(await save("c")).toBe("QUEUE_FULL"); // max_items is 2
    expect(
      await saveOfflinePunch({
        clientPunchId: "d",
        method: "qr",
        evidence: { qr_payload: "x", snapshot_jpeg: "y" },
        location: LOCATION,
        settings: { ...SETTINGS, max_items: 10 },
        offlineReady: false,
      }),
    ).toBe("OFFLINE_STORAGE_TOO_SMALL");
  });
});

describe("sending the saved punches", () => {
  async function queueTwo() {
    await pairDevice();
    rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });
    await save("11111111-0000-0000-0000-00000000000a");
    await save("11111111-0000-0000-0000-00000000000b");
  }

  it("deletes saved, already-saved and refused items and keeps 'retry later'", async () => {
    await queueTwo();
    const calls = mockApi({
      "POST /kiosk/sync": {
        body: {
          results: [
            { client_punch_id: "x", result: "saved" },
            { client_punch_id: "y", result: "retry_later" },
          ],
        },
      },
    });

    const round = await syncOnce();

    expect(round).toEqual({ kind: "sent", done: 1, kept: 1 });
    const sent = calls[0]?.body as { items: { counter: number }[] };
    expect(sent.items.map((item) => item.counter)).toEqual([6, 7]); // oldest first
    expect((await queueSummary()).count).toBe(1);
  });

  it("keeps everything while the internet is still down", async () => {
    await queueTwo();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await syncOnce()).toEqual({ kind: "offline" });
    expect((await queueSummary()).count).toBe(2);
  });

  it("says so when the device was switched off, so the queue can be thrown away", async () => {
    await queueTwo();
    mockApi({
      "POST /kiosk/sync": () => apiError(403, "DEVICE_REVOKED"),
    });

    expect(await syncOnce()).toEqual({ kind: "revoked" });
  });

  it("does nothing when nothing is waiting", async () => {
    await pairDevice();

    expect(await syncOnce()).toEqual({ kind: "empty" });
  });
});
