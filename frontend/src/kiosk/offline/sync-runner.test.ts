// Sending saved punches (spec M4 §7 rule 11, §5.2): the device deletes a saved punch only when the
// server answers saved, already_saved or refused; "retry later", a missing answer and a failed
// request keep it. A switched-off device and an older server are told apart.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { createDeviceKey } from "../device-key";
import { forgetDevice, queueSummary, saveDevice } from "../device-store";
import { type KioskOfflineSettings, saveOfflinePunch } from "./offline-queue";
import { syncOnce } from "./sync-runner";
import vector from "./test-vector.json";
import { forgetAnchorForTests, rememberAnchor } from "./time-anchor";

const SETTINGS: KioskOfflineSettings = {
  enabled: true,
  evidence_key_id: "A",
  evidence_public_key: vector.server_public_key,
  max_items: 2000,
  max_mb: 200,
  max_hours: 72,
  cooldown_minutes: 2,
  challenge_steps: 1,
  sync_max_items: 20,
  sync_max_bytes: 1_048_576,
};

async function pairAndSave(howMany: number) {
  const key = await createDeviceKey();
  await saveDevice({
    privateKey: key.privateKey,
    publicKeySpki: key.publicKeySpki,
    paired: {
      kioskId: vector.kiosk_id,
      kioskName: "Main gate",
      plantId: "p-1",
      plantCode: "K134",
      plantName: "Sheet Shapers",
      accuracyM: 10,
    },
    counter: 5,
  });
  rememberAnchor({ server_time: "2026-10-28T08:00:00Z", counter: 5, token: "t" });
  const ids: string[] = [];
  for (let n = 0; n < howMany; n += 1) {
    const clientPunchId = crypto.randomUUID();
    ids.push(clientPunchId);
    await saveOfflinePunch({
      clientPunchId,
      method: "qr",
      evidence: { qr_payload: "x", snapshot_jpeg: "y" },
      location: { lat: 19.85, lon: 75.25, accuracy_m: 10, age_s: 1 },
      settings: SETTINGS,
      offlineReady: true,
    });
  }
  return ids;
}

beforeEach(async () => {
  await forgetDevice();
  forgetAnchorForTests();
  vi.unstubAllGlobals();
});

describe("sending the saved punches", () => {
  it("has nothing to do with an empty queue", async () => {
    mockApi({});
    expect(await syncOnce()).toEqual({ kind: "empty" });
  });

  it("deletes what the server saved, already had or refused, and keeps the rest", async () => {
    await pairAndSave(4);
    mockApi({
      "POST /kiosk/sync": {
        body: {
          results: [
            { client_punch_id: null, result: "saved" },
            { client_punch_id: null, result: "already_saved" },
            { client_punch_id: null, result: "refused" },
            { client_punch_id: null, result: "retry_later" },
          ],
        },
      },
    });

    expect(await syncOnce()).toEqual({ kind: "sent", done: 3, kept: 1 });

    expect((await queueSummary()).count).toBe(1);
  });

  it("keeps a punch the answer does not mention (a short reply never loses a punch)", async () => {
    await pairAndSave(2);
    mockApi({
      "POST /kiosk/sync": { body: { results: [{ client_punch_id: null, result: "saved" }] } },
    });

    expect(await syncOnce()).toEqual({ kind: "sent", done: 1, kept: 1 });

    expect((await queueSummary()).count).toBe(1);
  });

  it("sends at most the number of punches it is allowed to in one request", async () => {
    await pairAndSave(3);
    const calls = mockApi({
      "POST /kiosk/sync": { body: { results: [{ client_punch_id: null, result: "saved" }] } },
    });

    await syncOnce({ maxItems: 1, maxBytes: 900_000 });

    const body = calls[0]?.body as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });
});

describe("when sending does not work", () => {
  it("says so and keeps everything when the device was switched off", async () => {
    await pairAndSave(1);
    mockApi({ "POST /kiosk/sync": apiError(403, "DEVICE_REVOKED") });

    expect(await syncOnce()).toEqual({ kind: "revoked" });

    expect((await queueSummary()).count).toBe(1); // the hook deletes it, with a count for the screen
  });

  it("tells an older server without /kiosk/sync from a missing internet", async () => {
    await pairAndSave(1);
    mockApi({ "POST /kiosk/sync": apiError(404, "NOT_FOUND") });
    expect(await syncOnce()).toEqual({ kind: "not-available" });

    mockApi({ "POST /kiosk/sync": apiError(503, "OFFLINE_NOT_CONFIGURED") });
    expect(await syncOnce()).toEqual({ kind: "not-available" });

    mockApi({ "POST /kiosk/sync": apiError(0, "NETWORK_ERROR") });
    expect(await syncOnce()).toEqual({ kind: "offline" });
    expect((await queueSummary()).count).toBe(1);
  });
});
