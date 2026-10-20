// The /kiosk pairing screen end to end (spec AC-13, AC-14, AC-15, AC-39): typing the code,
// the location step, every error screen, the QR-link prefill and an already paired device.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mock-api";
import { renderRoute } from "../test/render";
import { createDeviceKey } from "./device-key";
import { forgetDevice, loadDevice, saveDevice } from "./device-store";

type FakeGeolocation = {
  accuracy?: number;
  denied?: boolean;
};

// A fake `navigator.geolocation`: answers once, straight away.
function useFakeLocation({ accuracy = 18, denied = false }: FakeGeolocation = {}) {
  const geolocation = {
    watchPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
      setTimeout(() => {
        if (denied) {
          failure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
        } else {
          success({
            coords: { latitude: 19.85, longitude: 75.2, accuracy },
          } as GeolocationPosition);
        }
      }, 0);
      return 1;
    },
    clearWatch: () => {},
  };
  vi.stubGlobal("navigator", { ...navigator, geolocation });
}

const REGISTERED = {
  kiosk_id: "11111111-2222-3333-4444-555555555555",
  kiosk_name: "Main gate phone",
  plant: { id: "p-1", name: "Sheet Shapers (K-134)", code: "K134" },
  server_time: "2026-10-13T09:24:07Z",
};

// The heartbeat answer once paired (M2 adds notices and the kiosk screen settings).
const ME = {
  ...REGISTERED,
  status: "active",
  notices: [],
  kiosk_settings: {
    voice_enabled: true,
    sound_enabled: true,
    result_seconds: 4,
    reject_seconds: 6,
    snapshot_retention_days: 60,
    dark_threshold: 40,
  },
};
// After pairing, the kiosk opens the attendance screen with the plant and kiosk in the top bar.
const PLANT_TITLE = "Sheet Shapers (K-134) · K134";

async function typeCode(code: string) {
  const user = userEvent.setup();
  for (const digit of code) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  return user;
}

beforeEach(async () => {
  await forgetDevice();
  window.history.replaceState(null, "", "/kiosk");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kiosk pairing", () => {
  it("pairs with the code and the location, then opens the attendance screen", async () => {
    useFakeLocation({ accuracy: 18 });
    const calls = mockApi({
      "POST /kiosk/register": { body: REGISTERED },
      "GET /kiosk/me": { body: ME },
    });

    renderRoute("/kiosk");
    await screen.findByRole("heading", { name: "Pair this device" });
    expect(screen.getByRole("button", { name: "Type all 6 digits" })).toBeDisabled();
    const user = await typeCode("482913");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    expect(await screen.findByText(PLANT_TITLE)).toBeInTheDocument();
    expect(screen.getByText("Main gate phone")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/kiosk/register")?.body as Record<
      string,
      unknown
    >;
    expect(sent.pairing_code).toBe("482913");
    expect(sent.location).toEqual({ lat: 19.85, lon: 75.2, accuracy_m: 18 });
    expect(typeof sent.public_key_spki).toBe("string");
    // The device remembers it: the private key is stored but not extractable.
    const stored = await loadDevice();
    expect(stored?.paired.kioskId).toBe(REGISTERED.kiosk_id);
    expect(stored?.privateKey.extractable).toBe(false);
  });

  it("keeps a wrong code on the typing screen with a clear message", async () => {
    useFakeLocation();
    mockApi({ "POST /kiosk/register": apiError(400, "PAIRING_CODE_INVALID") });

    renderRoute("/kiosk");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("111111");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    expect(await screen.findByText("This code is not right. Type it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type all 6 digits" })).toBeDisabled();
  });

  it("explains location problems and never calls the server when location is refused", async () => {
    useFakeLocation({ denied: true });
    const calls = mockApi({});

    renderRoute("/kiosk");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("482913");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    expect(await screen.findByRole("heading", { name: "Location is off" })).toBeInTheDocument();
    expect(screen.getByText("LOCATION_REQUIRED")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["GPS_ACCURACY_TOO_LOW", "Location not accurate enough"],
    ["OUTSIDE_GEOFENCE", "Not at the plant"],
    ["PAIRING_CODE_EXPIRED", "Code expired"],
    ["PAIRING_LOCKED", "Too many tries"],
  ])("shows the %s screen with the code for the admin", async (code, title) => {
    useFakeLocation();
    mockApi({ "POST /kiosk/register": apiError(422, code) });

    renderRoute("/kiosk");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("482913");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(code)).toBeInTheDocument();
  });

  it("lets the worker try again after a weak location, and a new code after expiry", async () => {
    useFakeLocation();
    let attempts = 0;
    mockApi({
      "POST /kiosk/register": () => {
        attempts += 1;
        return attempts === 1 ? apiError(422, "GPS_ACCURACY_TOO_LOW") : { body: REGISTERED };
      },
      "GET /kiosk/me": { body: ME },
    });

    renderRoute("/kiosk");
    await screen.findByRole("heading", { name: "Pair this device" });
    const user = await typeCode("482913");
    await user.click(screen.getByRole("button", { name: "Pair this device" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText(PLANT_TITLE)).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("fills the code from the QR link and removes it from the address", async () => {
    useFakeLocation();
    mockApi({});
    window.history.replaceState(null, "", "/kiosk?code=482913");

    renderRoute("/kiosk");

    expect(await screen.findByText("Code filled in from the link.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pair this device" })).toBeEnabled();
    expect(window.location.search).toBe("");
  });

  it("asks for a supported browser when location is not available at all", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    mockApi({});
    // jsdom: the property must be missing, not undefined, for the "in" check.
    const withoutGeolocation = { ...navigator };
    delete (withoutGeolocation as { geolocation?: unknown }).geolocation;
    vi.stubGlobal("navigator", withoutGeolocation);

    renderRoute("/kiosk");

    expect(
      await screen.findByRole("heading", { name: "Browser not supported" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("a device that is already paired", () => {
  async function storePairedDevice() {
    const key = await createDeviceKey();
    await saveDevice({
      privateKey: key.privateKey,
      publicKeySpki: key.publicKeySpki,
      paired: {
        kioskId: REGISTERED.kiosk_id,
        kioskName: "Main gate phone",
        plantId: "p-1",
        plantCode: "K134",
        plantName: "Sheet Shapers (K-134)",
        accuracyM: 18,
      },
      counter: 0,
    });
  }

  it("goes straight to the attendance screen after the server confirms it", async () => {
    useFakeLocation();
    await storePairedDevice();
    mockApi({ "GET /kiosk/me": { body: ME } });

    renderRoute("/kiosk");

    expect(await screen.findByText(PLANT_TITLE)).toBeInTheDocument();
    expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1" })).not.toBeInTheDocument();
  });

  it("shows 'Switched off' when the admin revoked it, and pairs again with a new code", async () => {
    useFakeLocation();
    await storePairedDevice();
    mockApi({ "GET /kiosk/me": apiError(403, "DEVICE_REVOKED") });

    renderRoute("/kiosk");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Switched off" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Type a new code" }));
    expect(await screen.findByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
    expect(await loadDevice()).toBeUndefined();
  });

  it("starts again when the server does not know this device any more", async () => {
    useFakeLocation();
    await storePairedDevice();
    mockApi({ "GET /kiosk/me": apiError(401, "DEVICE_SIGNATURE_INVALID") });

    renderRoute("/kiosk");

    expect(await screen.findByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
    expect(await loadDevice()).toBeUndefined();
  });
});
