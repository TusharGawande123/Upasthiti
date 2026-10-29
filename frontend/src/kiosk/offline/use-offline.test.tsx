// The gate's offline hook (M4 spec §7 rules 11 and 12; AC-19, AC-44): the storage self-check, the
// waiting count, sending by itself when the internet is back, and throwing the queue away when
// the device is switched off.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { createDeviceKey } from "../device-key";
import { dropQueueOfRevokedDevice, forgetDevice, queueSummary, saveDevice } from "../device-store";
import { type KioskOfflineSettings, queueFillShare, saveOfflinePunch } from "./offline-queue";
import vector from "./test-vector.json";
import { forgetAnchorForTests, rememberAnchor } from "./time-anchor";
import { checkStorage, useOfflineGate } from "./use-offline";

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
const LOCATION = { lat: 19.85, lon: 75.25, accuracy_m: 10, age_s: 1 };
const EVIDENCE = { qr_payload: "x", snapshot_jpeg: "y" };

function stubStorage(quotaMb: number | null, persisted = true) {
  vi.stubGlobal("navigator", {
    ...navigator,
    storage: {
      persist: async () => persisted,
      estimate: async () => (quotaMb === null ? {} : { quota: quotaMb * 1024 * 1024, usage: 0 }),
    },
  });
}

async function pairAndSavePunch() {
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
  await saveOfflinePunch({
    clientPunchId: crypto.randomUUID(),
    method: "qr",
    evidence: EVIDENCE,
    location: LOCATION,
    settings: SETTINGS,
    offlineReady: true,
  });
}

beforeEach(async () => {
  await forgetDevice();
  forgetAnchorForTests();
  vi.unstubAllGlobals();
});

describe("the storage self-check", () => {
  it("is ready only with the queue's size plus 50 MB free", async () => {
    stubStorage(300);
    expect((await checkStorage(200)).ready).toBe(true);
    stubStorage(240);
    expect((await checkStorage(200)).ready).toBe(false);
  });

  it("is not ready when the browser gives no estimate or fails", async () => {
    stubStorage(null);
    expect((await checkStorage(200)).ready).toBe(false);
    vi.stubGlobal("navigator", { ...navigator, storage: undefined });
    expect((await checkStorage(200)).ready).toBe(false);
  });
});

describe("the hook", () => {
  const revoked = vi.fn();

  it("is ready with offline mode on and room to spare, and may save only while offline", async () => {
    stubStorage(1000);
    const { result, rerender } = renderHook(
      ({ online }) =>
        useOfflineGate({ settings: SETTINGS, online, busy: false, onRevoked: revoked }),
      { initialProps: { online: true } },
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.canSave).toBe(false);
    rerender({ online: false });
    expect(result.current.canSave).toBe(true);
  });

  it("is not ready without offline mode on the server", async () => {
    stubStorage(1000);
    const { result } = renderHook(() =>
      useOfflineGate({ settings: undefined, online: false, busy: false, onRevoked: revoked }),
    );

    expect(result.current.ready).toBe(false);
    expect(result.current.canSave).toBe(false);
    const saved = await result.current.save({
      clientPunchId: "a",
      method: "qr",
      evidence: EVIDENCE,
      location: LOCATION,
    });
    expect(saved).toBe("OFFLINE_NOT_READY");
  });

  it("needs a location to save a punch", async () => {
    stubStorage(1000);
    const { result } = renderHook(() =>
      useOfflineGate({ settings: SETTINGS, online: false, busy: false, onRevoked: revoked }),
    );

    const saved = await result.current.save({
      clientPunchId: "a",
      method: "qr",
      evidence: EVIDENCE,
      location: null,
    });

    expect(saved).toBe("OFFLINE_NOT_READY");
  });

  it("sends the saved punches by itself once it is online, and the waiting count goes to 0", async () => {
    stubStorage(1000);
    await pairAndSavePunch();
    const calls = mockApi({
      "POST /kiosk/sync": {
        body: {
          results: [{ client_punch_id: "x", result: "saved" }],
          server_time: "2026-10-28T09:00:00Z",
        },
      },
    });

    const { result } = renderHook(() =>
      useOfflineGate({ settings: SETTINGS, online: true, busy: false, onRevoked: revoked }),
    );

    // First the waiting punch is seen (count 1), then it is sent and the count goes back to 0.
    await waitFor(() => expect(calls.some((call) => call.path === "/kiosk/sync")).toBe(true), {
      timeout: 5000,
    });
    await waitFor(() => expect(result.current.queue.count).toBe(0), { timeout: 5000 });
    expect(result.current.lastSentAtMs).not.toBeNull();
  });

  it("does not send while a punch is on the screen", async () => {
    stubStorage(1000);
    await pairAndSavePunch();
    const calls = mockApi({ "POST /kiosk/sync": { body: { results: [] } } });

    const { result } = renderHook(() =>
      useOfflineGate({ settings: SETTINGS, online: true, busy: true, onRevoked: revoked }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(calls).toHaveLength(0);
    expect(result.current.queue.count).toBe(1);
  });

  it("tells the screen when the device was switched off", async () => {
    stubStorage(1000);
    await pairAndSavePunch();
    mockApi({ "POST /kiosk/sync": () => apiError(403, "DEVICE_REVOKED") });
    const switchedOff = vi.fn();

    renderHook(() =>
      useOfflineGate({ settings: SETTINGS, online: true, busy: false, onRevoked: switchedOff }),
    );

    await waitFor(() => expect(switchedOff).toHaveBeenCalled(), { timeout: 5000 });
  });
});

describe("a switched-off device's queue", () => {
  it("is counted and deleted at once (nothing can ever be sent with a revoked key)", async () => {
    stubStorage(1000);
    await pairAndSavePunch();
    expect((await queueSummary()).count).toBe(1);

    expect(await dropQueueOfRevokedDevice()).toBe(1);

    expect((await queueSummary()).count).toBe(0);
    expect(await dropQueueOfRevokedDevice()).toBe(0);
  });
});

describe("how full the queue is", () => {
  it("takes the larger share of the item count and the size", () => {
    const limits = { max_items: 2000, max_mb: 200 };

    expect(queueFillShare({ count: 0, bytes: 0 }, limits)).toBe(0);
    expect(queueFillShare({ count: 1600, bytes: 0 }, limits)).toBeCloseTo(0.8);
    expect(queueFillShare({ count: 10, bytes: 180 * 1024 * 1024 }, limits)).toBeCloseTo(0.9);
    expect(queueFillShare({ count: 2000, bytes: 0 }, limits)).toBe(1);
  });
});
