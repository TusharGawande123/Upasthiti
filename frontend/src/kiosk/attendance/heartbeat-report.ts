// What the gate tells the server in each heartbeat (M4 spec §5.2): how many punches wait on the
// device, how good its location is, its storage, battery and camera. Counts and states only:
// never what the saved punches contain, and never a name.

import type { QueueSummary } from "../device-store";
import type { GateLocation, LocationState } from "../location/gate-location";
import type { StorageCheck } from "../offline/use-offline";

/** Before the screen has anything to report (the very first beat). */
export function emptyFacts(): HeartbeatFacts {
  return {
    queue: { count: 0, bytes: 0, oldestSavedWallMs: null },
    place: {
      state: "finding",
      distanceM: null,
      reading: null,
      paused: false,
      usable: false,
      report: () => null,
    },
    storage: null,
    offlineReady: false,
    cameraReady: false,
  };
}

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export type HeartbeatBody = {
  queue: { count: number; bytes: number; oldest_punch_at?: string };
  location: {
    state: "good" | "weak" | "none" | "denied" | "outside" | "stale";
    lat?: number;
    lon?: number;
    accuracy_m?: number;
    age_s?: number;
  };
  storage: {
    persisted: boolean | null;
    quota_mb?: number;
    usage_mb?: number;
    offline_ready: boolean;
  };
  battery: { level: number; charging: boolean } | null;
  camera_ok: boolean | null;
  app_version: string;
};

/** What the gate knows right now; collected by the screen and read by the heartbeat timer. */
export type HeartbeatFacts = {
  queue: QueueSummary;
  place: GateLocation;
  storage: StorageCheck | null;
  offlineReady: boolean;
  cameraReady: boolean;
};

// The server has no "finding" state: a gate that has just opened has no location yet.
const SERVER_STATE: Record<LocationState, HeartbeatBody["location"]["state"]> = {
  finding: "none",
  good: "good",
  stale: "stale",
  weak: "weak",
  outside: "outside",
  none: "none",
  denied: "denied",
};

type BatteryManager = { level: number; charging: boolean };

/** The Battery Status API exists only in some browsers; where it does not, "not reported". */
async function readBattery(): Promise<HeartbeatBody["battery"]> {
  try {
    const getBattery = (navigator as { getBattery?: () => Promise<BatteryManager> }).getBattery;
    if (typeof getBattery !== "function") return null;
    const battery = await getBattery.call(navigator);
    return { level: Math.min(1, Math.max(0, battery.level)), charging: battery.charging };
  } catch {
    return null;
  }
}

export async function buildHeartbeat(facts: HeartbeatFacts): Promise<HeartbeatBody> {
  const { queue, place, storage } = facts;
  const reading = place.reading;
  return {
    queue: {
      count: queue.count,
      bytes: queue.bytes,
      ...(queue.oldestSavedWallMs !== null
        ? { oldest_punch_at: new Date(queue.oldestSavedWallMs).toISOString() }
        : {}),
    },
    location: {
      state: SERVER_STATE[place.state],
      ...(reading
        ? {
            lat: reading.lat,
            lon: reading.lon,
            accuracy_m: Math.round(reading.accuracyM * 10) / 10,
            age_s: Math.max(0, Math.round((Date.now() - reading.atMs) / 1000)),
          }
        : {}),
    },
    storage: {
      persisted: storage?.persisted ?? null,
      ...(storage?.quotaMb != null ? { quota_mb: storage.quotaMb } : {}),
      ...(storage?.usageMb != null ? { usage_mb: storage.usageMb } : {}),
      offline_ready: facts.offlineReady,
    },
    battery: await readBattery(),
    camera_ok: facts.cameraReady,
    app_version: APP_VERSION,
  };
}
