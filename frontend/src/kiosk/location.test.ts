// Location measuring for pairing: best reading wins, stops early when accurate, and a refused
// permission is reported at once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationError, measureLocation } from "./location";

type Callbacks = { success: PositionCallback; failure: PositionErrorCallback };

function fakeGeolocation() {
  const callbacks: Callbacks = { success: () => {}, failure: () => {} };
  const clearWatch = vi.fn();
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
        callbacks.success = success;
        callbacks.failure = failure;
        return 7;
      },
      clearWatch,
    },
  });
  const reading = (accuracy: number) =>
    callbacks.success({
      coords: { latitude: 19.85, longitude: 75.2, accuracy },
    } as GeolocationPosition);
  return { callbacks, clearWatch, reading };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("measureLocation", () => {
  it("waits the full time and returns the most accurate reading", async () => {
    vi.useFakeTimers();
    const { reading, clearWatch } = fakeGeolocation();
    const seen: number[] = [];

    const result = measureLocation({ onReading: (value) => seen.push(value.accuracy_m) });
    reading(140);
    reading(90);
    reading(120);
    await vi.advanceTimersByTimeAsync(20_000);

    expect((await result).accuracy_m).toBe(90);
    expect(seen).toEqual([140, 90, 120]);
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("stops early once a reading is accurate enough", async () => {
    fakeGeolocation().reading(12);
    const { reading } = fakeGeolocation();

    const result = measureLocation();
    reading(15);

    expect((await result).accuracy_m).toBe(15);
  });

  it("reports refused permission straight away", async () => {
    const { callbacks } = fakeGeolocation();

    const result = measureLocation();
    callbacks.failure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);

    await expect(result).rejects.toMatchObject({ reason: "denied" });
    await expect(result).rejects.toBeInstanceOf(LocationError);
  });

  it("says unavailable when no reading arrives in time", async () => {
    vi.useFakeTimers();
    fakeGeolocation();

    const result = measureLocation();
    const assertion = expect(result).rejects.toMatchObject({ reason: "unavailable" });
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });
});
