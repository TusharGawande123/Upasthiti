// The gate's own location check (M4 spec §7 rule 3, AC-2, AC-36): distance to the fence on the
// device and when punching pauses. The server decides every punch again; these are the guides.
import { describe, expect, it } from "vitest";
import { distanceToFenceM, type GateFence } from "./fence-distance";
import {
  DEFAULT_LOCATION_SETTINGS,
  FINDING_MS,
  isUsable,
  judgeLocation,
  type KioskLocationSettings,
  OFFLINE_REUSE_MS,
  pauseCode,
  type Reading,
  toReport,
} from "./gate-location";

const METRES_PER_DEGREE_LAT = 111_195;
const GATE = { lat: 19.85, lon: 75.25 };

const circle: GateFence = {
  version_id: "fence-1",
  shape: "circle",
  geojson: { type: "Point", coordinates: [GATE.lon, GATE.lat] },
  radius_m: 200,
  buffer_m: 25,
};

// A square of about 222 m around the gate (0.001 degrees on each side of the centre).
const square: GateFence = {
  version_id: "fence-2",
  shape: "polygon",
  geojson: {
    type: "Polygon",
    coordinates: [
      [
        [75.249, 19.849],
        [75.251, 19.849],
        [75.251, 19.851],
        [75.249, 19.851],
        [75.249, 19.849],
      ],
    ],
  },
  radius_m: null,
  buffer_m: 25,
};

const settings: KioskLocationSettings = { ...DEFAULT_LOCATION_SETTINGS, geofence: circle };

function northOfGate(metres: number, accuracyM = 10, atMs = 0): Reading {
  return { lat: GATE.lat + metres / METRES_PER_DEGREE_LAT, lon: GATE.lon, accuracyM, atMs };
}

function judge(overrides: Partial<Parameters<typeof judgeLocation>[0]>) {
  return judgeLocation({
    latest: northOfGate(0),
    lastGood: null,
    denied: false,
    settings,
    online: true,
    nowMs: 1_000,
    openedAtMs: 0,
    ...overrides,
  });
}

describe("distance to the fence", () => {
  it("is 0 inside a circle and the metres beyond its edge outside", () => {
    expect(distanceToFenceM(circle, GATE.lat, GATE.lon)).toBe(0);
    const outside = northOfGate(260);
    expect(distanceToFenceM(circle, outside.lat, outside.lon)).toBeCloseTo(60, 0);
  });

  it("is 0 inside a polygon and the distance to the nearest side outside", () => {
    expect(distanceToFenceM(square, GATE.lat, GATE.lon)).toBe(0);
    const outside = northOfGate(0.001 * METRES_PER_DEGREE_LAT + 40);
    expect(distanceToFenceM(square, outside.lat, outside.lon)).toBeCloseTo(40, 0);
  });
});

describe("judging the reading", () => {
  it("is good inside the fence with a fresh, accurate reading", () => {
    expect(judge({}).state).toBe("good");
  });

  it("accepts the margin at the edge: the server flags it, the gate does not pause", () => {
    expect(judge({ latest: northOfGate(215) }).state).toBe("good");
  });

  it("is weak, outside, denied or finding as the case may be", () => {
    expect(judge({ latest: northOfGate(0, 120) }).state).toBe("weak");
    expect(judge({ latest: northOfGate(300) }).state).toBe("outside");
    expect(judge({ denied: true }).state).toBe("denied");
    expect(judge({ latest: null }).state).toBe("finding");
    expect(judge({ latest: null, nowMs: FINDING_MS + 1 }).state).toBe("none");
  });

  it("calls an old reading 'none' online, but reuses the last good one offline (stale)", () => {
    const old = northOfGate(0, 10, 0);
    const later = (DEFAULT_LOCATION_SETTINGS.max_age_seconds + 5) * 1000;

    expect(judge({ latest: old, lastGood: old, nowMs: later }).state).toBe("none");
    expect(judge({ latest: old, lastGood: old, nowMs: later, online: false }).state).toBe("stale");
    expect(
      judge({ latest: old, lastGood: old, nowMs: OFFLINE_REUSE_MS + 1, online: false }).state,
    ).toBe("none");
  });

  it("never reuses an old good reading when a newer one is weak or outside", () => {
    const good = northOfGate(0, 10, 0);
    const weak = northOfGate(0, 140, 500);

    expect(judge({ latest: weak, lastGood: good, online: false }).state).toBe("weak");
  });

  it("only judges accuracy when the server sent no fence", () => {
    const noFence = { ...settings, geofence: null };
    expect(judge({ settings: noFence, latest: northOfGate(5_000) }).state).toBe("good");
  });
});

describe("what the screen and the punch get", () => {
  it("names the cause with the gate-only codes", () => {
    expect(pauseCode("denied")).toBe("LOCATION_DENIED");
    expect(pauseCode("weak")).toBe("LOCATION_WEAK");
    expect(pauseCode("outside")).toBe("LOCATION_OUTSIDE");
    expect(pauseCode("none")).toBe("LOCATION_UNAVAILABLE");
    expect(isUsable("good") && isUsable("stale") && !isUsable("weak")).toBe(true);
  });

  it("sends the reading with its true age", () => {
    const report = toReport(northOfGate(0, 12.34, 1_000), 31_400);
    expect(report).toEqual({ lat: GATE.lat, lon: GATE.lon, accuracy_m: 12.3, age_s: 30 });
  });
});
