// A fake `navigator.geolocation` for gate tests (M4: the gate needs a good location to punch).
// Every watch and request answers at once with the reading in `fakeReading`; tests change it or
// make the browser refuse.
import { vi } from "vitest";

export const fakeReading = {
  latitude: 19.85,
  longitude: 75.25,
  accuracy: 10,
  denied: false,
};

export function resetFakeReading() {
  Object.assign(fakeReading, { latitude: 19.85, longitude: 75.25, accuracy: 10, denied: false });
}

function answer(success: PositionCallback, failure?: PositionErrorCallback | null) {
  if (fakeReading.denied) {
    failure?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    return;
  }
  success({
    coords: {
      latitude: fakeReading.latitude,
      longitude: fakeReading.longitude,
      accuracy: fakeReading.accuracy,
    },
    timestamp: Date.now(),
  } as GeolocationPosition);
}

export const fakeGeolocation = {
  watchPosition: vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
    answer(success, failure);
    return 1;
  }),
  getCurrentPosition: vi.fn(answer),
  clearWatch: vi.fn(),
};
