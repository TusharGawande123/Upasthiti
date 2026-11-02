// The phone code of the gate (M4b spec §4.2, §4.3): the panel on the idle screen (wide card and
// narrow button), "not available" when no fresh code arrives, nothing when the server says so,
// and the card reader's message when it sees a phone code (nothing is sent). Camera and QR
// decoder are fakes; screens, signed requests and texts are the real ones.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGeolocation, resetFakeReading } from "@/test/fake-geolocation";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { createDeviceKey } from "../device-key";
import { forgetDevice, saveDevice } from "../device-store";
import { DEFAULT_SCREEN_SETTINGS } from "./punch-types";

const fakes = vi.hoisted(() => ({ qrText: null as string | null }));

vi.mock("./camera", async (importOriginal) => {
  const real = await importOriginal<typeof import("./camera")>();
  return {
    ...real,
    countCameras: async () => 1,
    startCamera: async (video: HTMLVideoElement) => {
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      return { getTracks: () => [] } as unknown as MediaStream;
    },
    playAfterTap: async () => {},
  };
});
vi.mock("./qr-reader", async (importOriginal) => {
  const real = await importOriginal<typeof import("./qr-reader")>();
  return {
    ...real,
    createQrDetector: async () => ({ usesFallback: false, detect: async () => fakes.qrText }),
  };
});

const KIOSK_ID = "11111111-2222-3333-4444-555555555555";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

function me(phoneCode: { enabled: boolean } | null = { enabled: true }) {
  return {
    kiosk_id: KIOSK_ID,
    kiosk_name: "Main gate phone",
    status: "active",
    plant: { id: "p-1", name: "Sheet Shapers", code: "K134" },
    server_time: new Date().toISOString(),
    notices: [],
    kiosk_settings: {
      ...DEFAULT_SCREEN_SETTINGS,
      ...(phoneCode ? { phone_code: { ...phoneCode, refresh_seconds: 20, show_seconds: 60 } } : {}),
    },
  };
}

function freshCode(codeText: string | null = "UPG1.dev.1.mac") {
  const issued = Date.now();
  return {
    body: {
      code_text: codeText,
      svg: codeText ? SVG : null,
      issued_at: new Date(issued).toISOString(),
      expires_at: new Date(issued + 30_000).toISOString(),
      refresh_in_seconds: 20,
    },
  };
}

async function openGate() {
  const key = await createDeviceKey();
  await saveDevice({
    privateKey: key.privateKey,
    publicKeySpki: key.publicKeySpki,
    paired: {
      kioskId: KIOSK_ID,
      kioskName: "Main gate phone",
      plantId: "p-1",
      plantCode: "K134",
      plantName: "Sheet Shapers",
      accuracyM: 18,
    },
    counter: 0,
  });
  renderRoute("/attendance");
  await screen.findByText("Sheet Shapers · K134");
}

beforeEach(async () => {
  await forgetDevice();
  fakes.qrText = null;
  localStorage.clear();
  resetFakeReading();
  vi.stubGlobal("navigator", { ...navigator, geolocation: fakeGeolocation });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone code panel", () => {
  it("shows the code, the sentence and the timer on a wide screen", async () => {
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /kiosk/gate-code": freshCode() });
    await openGate();
    expect(
      await screen.findByRole("img", { name: "The phone code of this attendance device" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Workers with phone attendance: scan this with your phone"),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("timer")
        .some((node) => node.getAttribute("aria-label")?.startsWith("The code changes in")),
    ).toBe(true);
  });

  it("is hidden while a card punch is running and comes back when the gate is idle (AC-38)", async () => {
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /kiosk/gate-code": freshCode() });
    await openGate();
    const panel = () =>
      screen.queryByRole("img", { name: "The phone code of this attendance device" });
    expect(await screen.findByRole("img", { name: /phone code/ })).toBeInTheDocument();

    fakes.qrText = "UPS1.A.C000123.SIG";
    await screen.findByRole(
      "heading",
      { name: "Card read. Get ready for your photo." },
      { timeout: 3000 },
    );
    fakes.qrText = null;
    expect(panel()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(await screen.findByRole("img", { name: /phone code/ })).toBeInTheDocument();
  });

  it("shows nothing when the setting is off", async () => {
    const calls = mockApi({ "GET /kiosk/me": { body: me({ enabled: false }) } });
    await openGate();
    expect(screen.queryByText("Phone code")).not.toBeInTheDocument();
    expect(calls.some((call) => call.path === "/kiosk/gate-code")).toBe(false);
  });

  it("shows nothing when no worker at this plant has phone punching", async () => {
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /kiosk/gate-code": freshCode(null) });
    await openGate();
    await waitFor(() => expect(screen.queryByText("Phone code")).not.toBeInTheDocument());
    expect(
      screen.queryByText("Phone code not available now. Show your ID card."),
    ).not.toBeInTheDocument();
  });

  it("says the code is not available when the server cannot give a fresh one", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /kiosk/gate-code": apiError(500, "INTERNAL_ERROR"),
    });
    await openGate();
    expect(
      await screen.findByText("Phone code not available now. Show your ID card."),
    ).toBeInTheDocument();
  });

  it("is a button on a narrow screen that opens the code full width and closes again", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /kiosk/gate-code": freshCode() });
    const user = userEvent.setup();
    await openGate();
    await user.click(await screen.findByRole("button", { name: "Phone code" }));
    expect(
      screen.getByRole("img", { name: "The phone code of this attendance device" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Back to scanning in \d+ s/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByText(/Back to scanning in/)).not.toBeInTheDocument();
  });
});

describe("a phone code held to the card reader", () => {
  it("says the code is for phones and sends nothing", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me({ enabled: false }) },
    });
    await openGate();
    fakes.qrText = "UPG1.dev.1700000000.mac";
    expect(
      await screen.findByText(
        "This code is for phones. Show your ID card to this attendance device.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);
  });

  it("still says 'not an Upasthiti ID card' for any other code", async () => {
    mockApi({ "GET /kiosk/me": { body: me({ enabled: false }) } });
    await openGate();
    fakes.qrText = "upi://pay?pa=someone";
    expect(
      await screen.findByText("This is not an Upasthiti ID card.", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
