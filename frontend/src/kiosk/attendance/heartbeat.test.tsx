// What the gate tells the server every minute, and the fallback for an older server (M4 spec §5.2,
// §7 rule 16; AC-23). Counts, states and times only: never what a saved punch contains.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { createDeviceKey } from "../device-key";
import { forgetDevice, saveDevice } from "../device-store";
import type { GateLocation } from "../location/gate-location";
import { buildHeartbeat, emptyFacts, type HeartbeatFacts } from "./heartbeat-report";
import { useHeartbeat } from "./use-heartbeat";

const KIOSK_ID = "11111111-2222-3333-4444-555555555555";

function facts(changes: Partial<HeartbeatFacts> = {}): HeartbeatFacts {
  const place: GateLocation = {
    state: "weak",
    distanceM: 0,
    reading: { lat: 19.85, lon: 75.25, accuracyM: 140.04, atMs: Date.now() - 5_000 },
    paused: true,
    usable: false,
    report: () => null,
  };
  return {
    queue: { count: 12, bytes: 3_000_000, oldestSavedWallMs: Date.parse("2026-10-28T08:05:00Z") },
    place,
    storage: { ready: true, persisted: true, quotaMb: 5000, usageMb: 40 },
    offlineReady: true,
    cameraReady: true,
    ...changes,
  };
}

async function pair() {
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
    counter: 0,
  });
}

beforeEach(async () => {
  await forgetDevice();
  vi.unstubAllGlobals();
});

describe("the heartbeat report", () => {
  it("has counts, states and times only", async () => {
    const body = await buildHeartbeat(facts());

    expect(body.queue).toEqual({
      count: 12,
      bytes: 3_000_000,
      oldest_punch_at: "2026-10-28T08:05:00.000Z",
    });
    expect(body.location).toMatchObject({ state: "weak", lat: 19.85, accuracy_m: 140 });
    expect(body.storage).toEqual({
      persisted: true,
      quota_mb: 5000,
      usage_mb: 40,
      offline_ready: true,
    });
    expect(body.camera_ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/qr_payload|snapshot|employee_code|signed_item/);
  });

  it("says 'none' while the gate is still finding its location, and sends no position", async () => {
    const body = await buildHeartbeat(emptyFacts());

    expect(body.location).toEqual({ state: "none" });
    expect(body.queue).toEqual({ count: 0, bytes: 0 });
    expect(body.battery).toBeNull();
  });

  it("reports the battery where the browser has one, and 'not reported' where it does not", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      getBattery: async () => ({ level: 0.82, charging: true }),
    });
    expect((await buildHeartbeat(facts())).battery).toEqual({ level: 0.82, charging: true });

    vi.stubGlobal("navigator", { ...navigator, getBattery: undefined });
    expect((await buildHeartbeat(facts())).battery).toBeNull();
  });
});

describe("the heartbeat hook", () => {
  const ME = {
    kiosk_id: KIOSK_ID,
    kiosk_name: "Main gate",
    status: "active",
    plant: { id: "p-1", name: "Sheet Shapers", code: "K134" },
    server_time: "2026-10-28T08:00:00Z",
    notices: [],
    kiosk_settings: {},
  };

  it("sends the report with POST /kiosk/heartbeat and shows the server as online", async () => {
    await pair();
    const calls = mockApi({ "POST /kiosk/heartbeat": { body: ME } });
    const handlers = {
      onRevoked: vi.fn(),
      onUnpaired: vi.fn(),
      getReport: () => buildHeartbeat(facts()),
    };

    const { result } = renderHook(() => useHeartbeat(null, 0, handlers));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toMatchObject({ queue: { count: 12 } });
    await waitFor(() => expect(result.current.serverOffsetMs).not.toBe(0));
    expect(result.current.online).toBe(true);
  });

  it("asks an older server with GET /kiosk/me when the heartbeat is not there yet", async () => {
    await pair();
    const calls = mockApi({
      "POST /kiosk/heartbeat": () => apiError(404, "NOT_FOUND"),
      "GET /kiosk/me": { body: ME },
    });
    const handlers = {
      onRevoked: vi.fn(),
      onUnpaired: vi.fn(),
      getReport: () => buildHeartbeat(facts()),
    };

    renderHook(() => useHeartbeat(null, 0, handlers));

    await waitFor(() =>
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /kiosk/heartbeat",
        "GET /kiosk/me",
      ]),
    );
  });

  it("knows when the internet is gone and when the device was switched off", async () => {
    await pair();
    mockApi({}); // no answer for anything: the server cannot be reached
    const handlers = {
      onRevoked: vi.fn(),
      onUnpaired: vi.fn(),
      getReport: () => buildHeartbeat(facts()),
    };

    const { result } = renderHook(() => useHeartbeat(null, 0, handlers));
    await waitFor(() => expect(result.current.online).toBe(false));

    mockApi({ "POST /kiosk/heartbeat": () => apiError(403, "DEVICE_REVOKED") });
    const revoked = { ...handlers, onRevoked: vi.fn() };
    renderHook(() => useHeartbeat(null, 0, revoked));
    await waitFor(() => expect(revoked.onRevoked).toHaveBeenCalled());
  });
});
