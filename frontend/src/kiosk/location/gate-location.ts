// The gate device keeps measuring its own location and pauses punching while it has no good
// reading (M4 spec §4.1, §7 rule 3; decision 0025 item 1). This only guides the screen, so workers
// are not refused for nothing: the server checks every punch again and decides.
//
// A reading is GOOD when it is accurate enough, fresh enough and inside the fence + margin.
// Offline only, the last good reading of this page session may be reused ("stale"); the server
// then flags the punch LOCATION_STALE (§14 answer 1). A newer reading that is weak or outside
// always wins over an older good one.
import { useCallback, useEffect, useRef, useState } from "react";
import { distanceToFenceM, type GateFence } from "./fence-distance";

export type KioskLocationSettings = {
  accuracy_limit_m: number;
  max_age_seconds: number;
  refresh_seconds: number;
  geofence: GateFence | null;
};

export const DEFAULT_LOCATION_SETTINGS: KioskLocationSettings = {
  accuracy_limit_m: 50,
  max_age_seconds: 120,
  refresh_seconds: 30,
  geofence: null,
};

/** No good reading for this long shows the "needs its location" screen (§4.1). */
export const PAUSE_AFTER_MS = 10_000;
/** After the page opens, "Finding location…" is shown this long before a problem is shown. */
export const FINDING_MS = 20_000;
/** The longest time an offline gate may reuse its last good reading (offline_max_hours). */
export const OFFLINE_REUSE_MS = 72 * 60 * 60 * 1000;

export type LocationState =
  | "finding" // just opened, no reading yet
  | "good"
  | "stale" // offline: the last good reading of this session is reused
  | "weak" // accuracy worse than the limit
  | "outside" // beyond the fence + margin
  | "none" // no reading, or only an old one
  | "denied"; // the browser blocks location for this website

export type Reading = { lat: number; lon: number; accuracyM: number; atMs: number };

/** What a punch sends (spec M4 §5.1). */
export type LocationReport = { lat: number; lon: number; accuracy_m: number; age_s: number };

export type LocationVerdict = { state: LocationState; distanceM: number | null };

/** The people-facing cause on the "needs its location" screen (gate-only codes, §7 rule 18). */
export function pauseCode(state: LocationState): string {
  if (state === "denied") return "LOCATION_DENIED";
  if (state === "weak") return "LOCATION_WEAK";
  if (state === "outside") return "LOCATION_OUTSIDE";
  return "LOCATION_UNAVAILABLE";
}

export function isUsable(state: LocationState): boolean {
  return state === "good" || state === "stale";
}

/** Judges the newest reading. Pure, so the rules can be tested without a browser. */
export function judgeLocation(input: {
  latest: Reading | null;
  lastGood: Reading | null;
  denied: boolean;
  settings: KioskLocationSettings;
  online: boolean;
  nowMs: number;
  openedAtMs: number;
}): LocationVerdict {
  const { latest, lastGood, settings, nowMs } = input;
  if (input.denied) return { state: "denied", distanceM: null };
  if (latest === null) {
    const justOpened = nowMs - input.openedAtMs < FINDING_MS;
    return { state: justOpened ? "finding" : "none", distanceM: null };
  }
  const distanceM =
    settings.geofence === null ? null : distanceToFenceM(settings.geofence, latest.lat, latest.lon);
  if (latest.accuracyM > settings.accuracy_limit_m) return { state: "weak", distanceM };
  if (distanceM !== null && settings.geofence !== null && distanceM > settings.geofence.buffer_m) {
    return { state: "outside", distanceM };
  }
  const ageMs = nowMs - latest.atMs;
  if (ageMs <= settings.max_age_seconds * 1000) return { state: "good", distanceM };
  // An old reading: offline, the last good one of this session may be reused for a while.
  const reusable =
    !input.online && lastGood !== null && lastGood === latest && ageMs <= OFFLINE_REUSE_MS;
  return { state: reusable ? "stale" : "none", distanceM };
}

export function toReport(reading: Reading, nowMs: number): LocationReport {
  return {
    lat: reading.lat,
    lon: reading.lon,
    accuracy_m: Math.round(reading.accuracyM * 10) / 10,
    age_s: Math.max(0, Math.round((nowMs - reading.atMs) / 1000)),
  };
}

export type GateLocation = LocationVerdict & {
  reading: Reading | null;
  /** True while punching is paused: no usable reading for PAUSE_AFTER_MS (not while finding). */
  paused: boolean;
  usable: boolean;
  /** The reading a punch should carry right now, or null when none is usable. */
  report: () => LocationReport | null;
};

export function useGateLocation(
  settings: KioskLocationSettings | undefined,
  online: boolean,
): GateLocation {
  const limits = settings ?? DEFAULT_LOCATION_SETTINGS;
  const [latest, setLatest] = useState<Reading | null>(null);
  const [denied, setDenied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const openedAtMs = useRef(Date.now());
  const lastGood = useRef<Reading | null>(null);
  const lastUsableAtMs = useRef<number | null>(null);

  // Readings: watchPosition all the time, plus a fresh request every refresh_seconds, because a
  // device that does not move may report nothing new.
  useEffect(() => {
    const geolocation = navigator.geolocation as Geolocation | undefined;
    if (typeof geolocation?.watchPosition !== "function") return;
    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
    const onReading = (position: GeolocationPosition) => {
      setDenied(false);
      setLatest({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        atMs: Date.now(),
      });
    };
    const onError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) setDenied(true);
    };
    const watchId = geolocation.watchPosition(onReading, onError, options);
    const refresh = setInterval(
      () => geolocation.getCurrentPosition(onReading, onError, options),
      limits.refresh_seconds * 1000,
    );
    return () => {
      geolocation.clearWatch(watchId);
      clearInterval(refresh);
    };
  }, [limits.refresh_seconds]);

  // Ages change with time, so the verdict is worked out again every second.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const verdict = judgeLocation({
    latest,
    lastGood: lastGood.current,
    denied,
    settings: limits,
    online,
    nowMs,
    openedAtMs: openedAtMs.current,
  });
  if (verdict.state === "good") lastGood.current = latest;
  const usable = isUsable(verdict.state);
  if (usable) lastUsableAtMs.current = nowMs;
  const lastUsable = lastUsableAtMs.current ?? openedAtMs.current;
  const paused = !usable && verdict.state !== "finding" && nowMs - lastUsable >= PAUSE_AFTER_MS;

  const reading = usable ? latest : null;
  const report = useCallback(
    () => (reading === null ? null : toReport(reading, Date.now())),
    [reading],
  );
  return { ...verdict, reading: latest, paused, usable, report };
}
