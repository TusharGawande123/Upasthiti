// The pairing screen's key pad and its problem screens, one per server answer (spec M1 §4.8;
// M4 touches the same hook for the "Switched off" screen). The location is a fake that answers
// once, straight away.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mock-api";
import { renderRoute } from "../test/render";
import { forgetDevice } from "./device-store";

function useFakeLocation() {
  const geolocation = {
    watchPosition: (success: PositionCallback) => {
      setTimeout(
        () =>
          success({
            coords: { latitude: 19.85, longitude: 75.2, accuracy: 18 },
          } as GeolocationPosition),
        0,
      );
      return 1;
    },
    clearWatch: () => {},
  };
  vi.stubGlobal("navigator", { ...navigator, geolocation });
}

async function typeCode(code: string) {
  const user = userEvent.setup();
  for (const digit of code) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  return user;
}

beforeEach(async () => {
  await forgetDevice();
  window.history.replaceState(null, "", "/attendance");
  useFakeLocation();
});

afterEach(() => vi.unstubAllGlobals());

describe("the code key pad", () => {
  it("takes at most six digits, removes the last one with Back and everything with Clear", async () => {
    mockApi({});
    renderRoute("/attendance");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("1234567"); // the seventh digit is ignored
    const pair = screen.getByRole("button", { name: "Pair this device" });
    expect(pair).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(pair).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "6" }));
    expect(pair).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(pair).toBeDisabled();
  });
});

describe("the problem screens", () => {
  const cases = [
    ["PAIRING_CODE_EXPIRED", "Code expired", "Type a new code"],
    ["PAIRING_LOCKED", "Too many tries", "Type a new code"],
    ["OUTSIDE_GEOFENCE", "Not at the plant", "Try again"],
    ["GPS_ACCURACY_TOO_LOW", "Location not accurate enough", "Try again"],
    ["NETWORK_ERROR", "No connection", "Try again"],
  ] as const;

  it.each(cases)("shows the right screen for %s", async (code, title, buttonName) => {
    mockApi({ "POST /kiosk/register": apiError(code === "NETWORK_ERROR" ? 0 : 422, code) });
    renderRoute("/attendance");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("482913");

    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: buttonName })).toBeInTheDocument();
  });

  it("starts again at the key pad after an expired code", async () => {
    mockApi({ "POST /kiosk/register": apiError(422, "PAIRING_CODE_EXPIRED") });
    renderRoute("/attendance");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("482913");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    await user.click(await screen.findByRole("button", { name: "Type a new code" }));

    expect(await screen.findByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Code expired" })).not.toBeInTheDocument();
  });
});
