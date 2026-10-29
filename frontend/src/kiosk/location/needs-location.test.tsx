// The "needs its location" screen and when it appears (M4 spec §4.1, AC-2, AC-40).
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGeolocation, fakeReading, resetFakeReading } from "@/test/fake-geolocation";
import type { GateFence } from "./fence-distance";
import {
  DEFAULT_LOCATION_SETTINGS,
  type GateLocation,
  type KioskLocationSettings,
  PAUSE_AFTER_MS,
  useGateLocation,
} from "./gate-location";
import { NeedsLocationScreen } from "./needs-location";

const fence: GateFence = {
  version_id: "fence-1",
  shape: "circle",
  geojson: { type: "Point", coordinates: [75.25, 19.85] },
  radius_m: 200,
  buffer_m: 25,
};
const settings: KioskLocationSettings = { ...DEFAULT_LOCATION_SETTINGS, geofence: fence };

function place(changes: Partial<GateLocation>): GateLocation {
  return {
    state: "weak",
    distanceM: 0,
    reading: { lat: 19.85, lon: 75.25, accuracyM: 140, atMs: 0 },
    paused: true,
    usable: false,
    report: () => null,
    ...changes,
  };
}

beforeEach(() => {
  resetFakeReading();
  vi.stubGlobal("navigator", { ...navigator, geolocation: fakeGeolocation });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pausing and resuming", () => {
  it("pauses after 10 s without a good reading and resumes by itself without a tap", () => {
    vi.useFakeTimers();
    fakeReading.accuracy = 140;
    const { result } = renderHook(() => useGateLocation(settings, true));

    expect(result.current.state).toBe("weak");
    expect(result.current.paused).toBe(false);
    act(() => vi.advanceTimersByTime(PAUSE_AFTER_MS + 1_000));
    expect(result.current.paused).toBe(true);
    expect(result.current.report()).toBeNull();

    fakeReading.accuracy = 12;
    act(() => vi.advanceTimersByTime(settings.refresh_seconds * 1000));
    expect(result.current.state).toBe("good");
    expect(result.current.paused).toBe(false);
    expect(result.current.report()).toMatchObject({ accuracy_m: 12 });
  });

  it("says when the browser blocks location", () => {
    fakeReading.denied = true;
    const { result } = renderHook(() => useGateLocation(settings, true));

    expect(result.current.state).toBe("denied");
  });
});

describe("the screen", () => {
  it("shows the cause, the sketch line and the admin code for a weak signal", () => {
    render(<NeedsLocationScreen place={place({})} settings={settings} />);

    expect(screen.getByText("This attendance device needs its location")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for a better location signal (now ±140 m, needed ±50 m)."),
    ).toBeInTheDocument();
    expect(screen.getByText("±140 m now, ±50 m needed")).toBeInTheDocument();
    expect(screen.getByText("Checking again…")).toBeInTheDocument();
    expect(screen.getByText("LOCATION_WEAK")).toBeInTheDocument();
  });

  it("draws how far outside the device is", () => {
    render(
      <NeedsLocationScreen
        place={place({
          state: "outside",
          distanceM: 61.4,
          reading: { lat: 19.8524, lon: 75.25, accuracyM: 10, atMs: 0 },
        })}
        settings={settings}
      />,
    );

    expect(screen.getByText("About 61 m outside the fence")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "About 61 m outside the fence" })).toBeInTheDocument();
    expect(screen.getByText("LOCATION_OUTSIDE")).toBeInTheDocument();
  });

  it("shows no sketch when there is no reading at all", () => {
    render(
      <NeedsLocationScreen place={place({ state: "denied", reading: null })} settings={settings} />,
    );

    expect(screen.getByText(/Location is blocked for this website/)).toBeInTheDocument();
    expect(screen.queryByText("Why paused?")).not.toBeInTheDocument();
  });
});
