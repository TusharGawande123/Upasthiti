// Measures the device's location for pairing: listens for up to 20 seconds, keeps the MOST
// accurate reading and stops early once it is good enough. The server decides if it is
// accurate enough and inside the geofence (decision 0005); this only collects the reading.

export type LocationReading = { lat: number; lon: number; accuracy_m: number };

export type LocationFailure = "denied" | "unavailable";

export class LocationError extends Error {
  readonly reason: LocationFailure;
  constructor(reason: LocationFailure) {
    super(reason);
    this.name = "LocationError";
    this.reason = reason;
  }
}

export const LOCATION_WAIT_MS = 20_000;
// A reading this accurate (metres) is used straight away; no need to wait longer.
export const LOCATION_GOOD_ENOUGH_M = 20;

type Options = {
  maxWaitMs?: number;
  goodEnoughM?: number;
  // Called for every reading, so the screen can show the accuracy getting better.
  onReading?: (reading: LocationReading) => void;
};

export function measureLocation({
  maxWaitMs = LOCATION_WAIT_MS,
  goodEnoughM = LOCATION_GOOD_ENOUGH_M,
  onReading,
}: Options = {}): Promise<LocationReading> {
  return new Promise((resolve, reject) => {
    let best: LocationReading | null = null;
    let finished = false;

    const finish = (action: () => void) => {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      action();
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const reading = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy_m: Math.round(position.coords.accuracy),
        };
        if (best === null || reading.accuracy_m < best.accuracy_m) best = reading;
        onReading?.(reading);
        if (best.accuracy_m <= goodEnoughM) {
          const chosen = best;
          finish(() => resolve(chosen));
        }
      },
      (error) => {
        // Permission refused is final. Other errors may pass; the timer decides at the end.
        if (error.code === error.PERMISSION_DENIED) {
          finish(() => reject(new LocationError("denied")));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );

    const timer = setTimeout(() => {
      finish(() => (best ? resolve(best) : reject(new LocationError("unavailable"))));
    }, maxWaitMs);
  });
}
