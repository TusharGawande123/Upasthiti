// The geofence map's extras: the "Show my location" button and the Map / Satellite switch.
// Leaflet itself is real; only the phone's GPS is a fake.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeofenceMap } from "./geofence-map";

function useFakeGps(behaviour: "found" | "denied") {
  const clearWatch = vi.fn();
  const geolocation = {
    watchPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
      setTimeout(() => {
        if (behaviour === "denied") {
          failure({ code: 1, message: "denied" } as GeolocationPositionError);
        } else {
          success({
            coords: { latitude: 19.85, longitude: 75.2, accuracy: 18 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }
      }, 0);
      return 7;
    },
    clearWatch,
  };
  vi.stubGlobal("navigator", { ...navigator, geolocation });
  return clearWatch;
}

function showMap() {
  render(<GeofenceMap saved={null} editable={false} marginM={20} label="Plant map" />);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geofence map: my location", () => {
  it("finds the device, shows how accurate it is and stops on the second click", async () => {
    const clearWatch = useFakeGps("found");
    showMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Show my location" }));

    expect(await screen.findByText("You are here (about 18 m)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop showing my location" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Stop showing my location" }));

    expect(clearWatch).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show my location" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("explains what to do when the location is refused", async () => {
    useFakeGps("denied");
    showMap();

    await userEvent.click(screen.getByRole("button", { name: "Show my location" }));

    expect(await screen.findByText(/Could not find your location/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show my location" })).toBeInTheDocument();
  });
});

describe("geofence map: map and satellite", () => {
  it("starts on the street map and remembers the satellite choice", async () => {
    showMap();

    expect(screen.getByRole("radio", { name: "Map" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Satellite" }));

    expect(localStorage.getItem("upasthiti.map.layer")).toBe("satellite");
  });

  it("opens on the satellite view when that was the last choice", () => {
    localStorage.setItem("upasthiti.map.layer", "satellite");

    showMap();

    expect(screen.getByRole("radio", { name: "Satellite" })).toBeChecked();
  });
});
