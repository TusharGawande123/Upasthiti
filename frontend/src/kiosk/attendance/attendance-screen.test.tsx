// The attendance screen of a paired kiosk (spec M2 §4.1 to §4.5, design gate B; AC-7, AC-10,
// AC-31, AC-32). The camera, the QR decoder and the photo are fakes; the screens, the timers,
// the signed requests and the texts are the real ones.

import { act, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGeolocation, fakeReading, resetFakeReading } from "@/test/fake-geolocation";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { createDeviceKey } from "../device-key";
import { forgetDevice, oldestQueued, queueSummary, saveDevice } from "../device-store";
import vector from "../offline/test-vector.json";
import { forgetAnchorForTests } from "../offline/time-anchor";
import { DEFAULT_SCREEN_SETTINGS, type PunchAnswer } from "./punch-types";

// --- Fakes for the hardware ---------------------------------------------------------------------

const fakes = vi.hoisted(() => ({
  /** What the fake decoder "sees" in the camera picture right now. */
  qrText: null as string | null,
  /** How the fake camera starts: "ok", "needs-tap", or a problem code. */
  camera: "ok" as string,
  /** How many cameras the fake device has (the switch button needs two). */
  cameraCount: 1,
  /** Which camera ("user" or "environment") every camera start asked for. */
  started: [] as string[],
}));

vi.mock("./camera", async (importOriginal) => {
  const real = await importOriginal<typeof import("./camera")>();
  return {
    ...real,
    countCameras: async () => fakes.cameraCount,
    startCamera: async (video: HTMLVideoElement, facing = "user") => {
      fakes.started.push(facing);
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      if (fakes.camera === "needs-tap") throw new real.CameraError("NEEDS_TAP");
      if (fakes.camera !== "ok") throw new real.CameraError(fakes.camera as "CAMERA_BLOCKED");
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

vi.mock("./snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./snapshot")>()),
  takeSnapshot: async () => "/9j/AA==",
}));

// --- Test data ----------------------------------------------------------------------------------

const KIOSK_ID = "11111111-2222-3333-4444-555555555555";
const CARD = "UPS1.A.C000123.SIGNATURE";

function me(changes: Record<string, unknown> = {}) {
  return {
    kiosk_id: KIOSK_ID,
    kiosk_name: "Main gate phone",
    status: "active",
    plant: { id: "p-1", name: "Sheet Shapers", code: "K134" },
    server_time: "2026-10-20T03:54:10Z",
    notices: [],
    // Short results, so the tests do not wait 4-6 seconds.
    kiosk_settings: {
      voice_enabled: true,
      sound_enabled: true,
      result_seconds: 1,
      reject_seconds: 1,
      photo_ready_seconds: 20,
      snapshot_retention_days: 60,
      dark_threshold: 40,
      face: DEFAULT_SCREEN_SETTINGS.face,
    },
    ...changes,
  };
}

function answer(changes: Partial<PunchAnswer> = {}): PunchAnswer {
  return {
    punch_id: "p-1",
    decision: "accepted",
    direction: "in",
    employee: { display_name: "Sunil More", employee_code: "T-2041" },
    server_time: "2026-10-20T01:32:00Z", // 07:02 IST
    reason_code: null,
    message_key: "kiosk.punch.accepted.in",
    voice_key: "kiosk.voice.in",
    details: { kiosk_name: "Main gate phone" },
    ...changes,
  };
}

async function openPairedKiosk() {
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

/** Holds a card up until the kiosk reads it and asks the person to get ready; then takes it away. */
async function showCardUntilReady(text = CARD) {
  fakes.qrText = text;
  await screen.findByRole(
    "heading",
    { name: "Card read. Get ready for your photo." },
    { timeout: 3000 },
  );
  fakes.qrText = null;
}

/** The whole card punch up to the photo: show the card, then tap "I'm ready". */
async function showCard(text = CARD) {
  await showCardUntilReady(text);
  await userEvent.click(await screen.findByRole("button", { name: /I'm ready/ }));
}

beforeEach(async () => {
  await forgetDevice();
  fakes.qrText = null;
  fakes.camera = "ok";
  fakes.cameraCount = 1;
  fakes.started = [];
  localStorage.clear();
  resetFakeReading();
  vi.stubGlobal("navigator", { ...navigator, geolocation: fakeGeolocation });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Tests --------------------------------------------------------------------------------------

describe("kiosk attendance screen", () => {
  it("opens straight to scanning with the instruction, the clock and the privacy line", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });

    await openPairedKiosk();

    expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument();
    expect(screen.getByText("Main gate phone")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Face punch: your face is checked against an encrypted record. A photo is kept for 60 days only if the punch fails or you type your code. Card punch: a photo is kept for 60 days and checked automatically to see that a face is present.",
      ),
    ).toBeInTheDocument();
  });

  it("reads a card, sends the photo with it and shows IN with the name and server time", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByText("IN")).toBeInTheDocument();
    expect(screen.getByText("Welcome,")).toBeInTheDocument();
    expect(screen.getByText("Sunil More")).toBeInTheDocument();
    expect(screen.getByText("Employee code T-2041 · Checked in")).toBeInTheDocument();
    expect(screen.getByText("07:02")).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/punch/kiosk")?.body as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({ method: "qr", qr_payload: CARD, snapshot_jpeg: "/9j/AA==" });
    // After the result time the kiosk scans again by itself (the scanning screen stays
    // underneath the result all the time, so the camera never stops).
    await waitForElementToBeRemoved(() => screen.queryByText("Sunil More"), { timeout: 3000 });
    expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument();
  });

  it("shows OUT with 'Goodbye'", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer({ direction: "out" }) },
    });
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByText("OUT")).toBeInTheDocument();
    expect(screen.getByText("Goodbye,")).toBeInTheDocument();
  });

  it("shows a rejection without the name, with the next step and the admin code", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": {
        body: answer({
          decision: "rejected",
          direction: null,
          employee: null,
          reason_code: "QR_REVOKED",
        }),
      },
    });
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByText("NOT ACCEPTED")).toBeInTheDocument();
    expect(screen.getByText("This card is blocked.")).toBeInTheDocument();
    expect(screen.getByText("Please visit the plant office.")).toBeInTheDocument();
    expect(screen.getByText("QR_REVOKED")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Sunil More")).not.toBeInTheDocument();
  });

  it("shows 'already IN' with the name and when OUT is allowed", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": {
        body: answer({
          decision: "rejected",
          direction: null,
          reason_code: "OUT_TOO_SOON",
          server_time: "2026-10-20T01:42:00Z",
          details: {
            kiosk_name: "Main gate phone",
            last_direction: "in",
            last_punch_at: "2026-10-20T01:32:00Z",
            out_allowed_from: "2026-10-20T02:02:00Z",
          },
        }),
      },
    });
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByText("ALREADY IN")).toBeInTheDocument();
    expect(screen.getByText("Sunil More")).toBeInTheDocument();
    expect(
      screen.getByText("Already IN at 07:02. You can punch OUT after 07:32."),
    ).toBeInTheDocument();
    expect(screen.queryByText("OUT_TOO_SOON")).not.toBeInTheDocument();
  });

  it("shows DEVICE OK for a test card and says no attendance was recorded", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": {
        body: answer({ decision: "self_test", direction: null, employee: null, punch_id: null }),
      },
    });
    await openPairedKiosk();

    await showCard("UPS1.A.T000009.SIGNATURE");

    expect(await screen.findByText("DEVICE OK")).toBeInTheDocument();
    expect(screen.getByText("No attendance was recorded.")).toBeInTheDocument();
    expect(
      screen.getByText("Camera ✓ · Server ✓ · Clock ✓ (server time 07:02:00)"),
    ).toBeInTheDocument();
  });

  it("says honestly that the punch was NOT saved when there is no internet", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } }); // the punch request finds no server
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByText("NOT SAVED")).toBeInTheDocument();
    expect(screen.getByText("No internet. Your punch was NOT saved.")).toBeInTheDocument();
    expect(screen.getByText("NETWORK_OFFLINE")).toBeInTheDocument();
    expect(screen.getAllByText("No internet").length).toBeGreaterThan(0);
  });

  it("ignores other QR codes with a short message and sends nothing", async () => {
    const calls = mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();

    fakes.qrText = "upi://pay?pa=shop@bank";

    expect(await screen.findByText("This is not an Upasthiti ID card.")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);
  });

  it("does not punch twice for a card that is still held up", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    fakes.qrText = CARD; // and it stays there
    await userEvent.click(
      await screen.findByRole("button", { name: /I'm ready/ }, { timeout: 3000 }),
    );
    await screen.findByText("IN", {}, { timeout: 3000 });
    await waitForElementToBeRemoved(() => screen.queryByText("Sunil More"), { timeout: 3000 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)));

    expect(calls.filter((call) => call.path === "/punch/kiosk")).toHaveLength(1);
  });

  it("shows the Switched off screen when the kiosk was revoked", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": apiError(403, "DEVICE_REVOKED"),
    });
    await openPairedKiosk();

    await showCard();

    expect(await screen.findByRole("heading", { name: "Switched off" })).toBeInTheDocument();
  });

  it("shows the gate notices, important ones first, with the word Important", async () => {
    mockApi({
      "GET /kiosk/me": {
        body: me({
          notices: [
            {
              id: "n-1",
              text: "Canteen timing today: 12:30 to 13:15.",
              level: "normal",
              ends_at: "2026-10-20T12:00:00Z",
            },
            {
              id: "n-2",
              text: "Gate 2 is closed for repair.",
              level: "important",
              ends_at: "2026-10-20T12:00:00Z",
            },
          ],
        }),
      },
    });

    await openPairedKiosk();

    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("ImportantGate 2 is closed for repair.");
    expect(items[1]).toHaveTextContent("Canteen timing today");
  });
});

describe("kiosk camera problems", () => {
  it("explains how to allow a blocked camera", async () => {
    fakes.camera = "CAMERA_BLOCKED";
    mockApi({ "GET /kiosk/me": { body: me() } });

    await openPairedKiosk();

    expect(await screen.findByRole("heading", { name: "Camera is blocked" })).toBeInTheDocument();
    expect(screen.getByText("Set Camera to “Allow”.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("CAMERA_BLOCKED")).toBeInTheDocument();
  });

  it("shows a Start camera button when the browser wants a tap, then scans", async () => {
    fakes.camera = "needs-tap";
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /punch/kiosk": { body: answer() } });
    await openPairedKiosk();
    const user = userEvent.setup();

    const startButton = await screen.findByRole("button", { name: "Start camera" });
    fakes.camera = "ok"; // after the tap the browser lets the picture play
    await user.click(startButton);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Start camera" })).not.toBeInTheDocument(),
    );
    await showCard();
    expect(await screen.findByText("IN")).toBeInTheDocument();
  });
});

describe("kiosk sound, voice and the one-tap banner", () => {
  // A browser that already allows sound (kiosk mode), with one Indian English voice.
  function stubSoundAndSpeech() {
    const spoken: string[] = [];
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        currentTime = 0;
        destination = {};
        async resume() {}
        createOscillator() {
          return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
        }
        createGain() {
          return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
        }
      },
    );
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ lang: "en-IN", localService: true, name: "Indian English" }],
      addEventListener: () => {},
      cancel: () => {},
      speak: (utterance: { text: string }) => spoken.push(utterance.text),
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        voice: unknown;
        lang = "";
        rate = 1;
        constructor(readonly text: string) {}
      },
    );
    return spoken;
  }

  it("speaks 'Checked in.' after an IN, never the name", async () => {
    const spoken = stubSoundAndSpeech();
    mockApi({ "GET /kiosk/me": { body: me() }, "POST /punch/kiosk": { body: answer() } });
    await openPairedKiosk();

    await showCard();
    await screen.findByText("IN");

    await waitFor(() => expect(spoken).toEqual(["Checked in."]));
    expect(spoken.join(" ")).not.toContain("Sunil");
  });

  it("stays silent when sound is switched off for this gate", async () => {
    const spoken = stubSoundAndSpeech();
    const quiet = me();
    quiet.kiosk_settings = { ...quiet.kiosk_settings, sound_enabled: false, voice_enabled: false };
    mockApi({ "GET /kiosk/me": { body: quiet }, "POST /punch/kiosk": { body: answer() } });
    await openPairedKiosk();

    await showCard();
    await screen.findByText("IN");
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));

    expect(spoken).toEqual([]);
  });

  it("turns on full screen with one tap on the banner, which then goes away", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });
    const requestFullscreen = vi.fn(async () => {});
    document.documentElement.requestFullscreen = requestFullscreen;
    await openPairedKiosk();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", {
        name: "Tap once to turn on sound and full screen. Tap again after every update.",
      }),
    );

    expect(requestFullscreen).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", {
        name: "Tap once to turn on sound and full screen. Tap again after every update.",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("getting ready for the photo", () => {
  it("waits for the person: nothing is sent until they tap I'm ready", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    await showCardUntilReady();

    expect(screen.getByText(/^Photo in \d+ s$/)).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: /I'm ready/ }));
    expect(await screen.findByText("IN")).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/punch/kiosk")).toHaveLength(1);
  });

  it("goes back to scanning without a punch when the person cancels", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();
    await showCardUntilReady();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Show your ID card to the camera")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);
  });

  it("takes the photo by itself when the time is over", async () => {
    // The gate setting says 2 seconds, so the test does not wait 20.
    const short = me().kiosk_settings as Record<string, unknown>;
    const calls = mockApi({
      "GET /kiosk/me": { body: me({ kiosk_settings: { ...short, photo_ready_seconds: 2 } }) },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();
    await showCardUntilReady();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);

    expect(await screen.findByText("IN", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/punch/kiosk")).toHaveLength(1);
  });
});

describe("switching between the front and the back camera", () => {
  it("shows no switch button on a device with one camera", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();

    await screen.findByText("Show your ID card to the camera");

    expect(screen.queryByRole("button", { name: "Use the back camera" })).not.toBeInTheDocument();
  });

  it("lets the person pick the camera that reads cards, and remembers it", async () => {
    fakes.cameraCount = 2;
    mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();

    await userEvent.click(await screen.findByRole("button", { name: "Use the back camera" }));

    await waitFor(() => expect(fakes.started.at(-1)).toBe("environment"));
    expect(localStorage.getItem("upasthiti.camera.scan")).toBe("environment");
    expect(localStorage.getItem("upasthiti.camera.photo")).toBeNull();
    expect(await screen.findByRole("button", { name: "Use the front camera" })).toBeInTheDocument();
  });

  it("uses a separate camera for the photo, and goes back to the card camera after it", async () => {
    fakes.cameraCount = 2;
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();
    await showCardUntilReady();

    await userEvent.click(await screen.findByRole("button", { name: "Use the back camera" }));

    await waitFor(() => expect(fakes.started.at(-1)).toBe("environment"));
    expect(localStorage.getItem("upasthiti.camera.photo")).toBe("environment");
    expect(localStorage.getItem("upasthiti.camera.scan")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /I'm ready/ }));
    await screen.findByText("IN");
    // After the punch the card camera (front, the default) is used again.
    await waitFor(() => expect(fakes.started.at(-1)).toBe("user"));
  });

  it("starts with the cameras the device remembers", async () => {
    fakes.cameraCount = 2;
    localStorage.setItem("upasthiti.camera.scan", "environment");
    mockApi({ "GET /kiosk/me": { body: me() } });

    await openPairedKiosk();
    await screen.findByText("Show your ID card to the camera");

    expect(fakes.started[0]).toBe("environment");
  });
});

describe("the gate's location (M4)", () => {
  it("sends its location with every card punch and shows it in the top bar", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    expect(await screen.findByText("Location good (±10 m)")).toBeInTheDocument();
    await showCard();

    expect(await screen.findByText("IN")).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/punch/kiosk")?.body as Record<
      string,
      unknown
    >;
    expect(sent.location).toMatchObject({ lat: 19.85, lon: 75.25, accuracy_m: 10 });
    expect((sent.location as { age_s: number }).age_s).toBeGreaterThanOrEqual(0);
  });

  it("does not read cards while the location is too weak", async () => {
    fakeReading.accuracy = 140;
    const calls = mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();

    expect(await screen.findByText("Location weak (±140 m)")).toBeInTheDocument();
    fakes.qrText = CARD;
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.queryByText(/Get ready for your photo/)).not.toBeInTheDocument();
    expect(calls.some((call) => call.path === "/punch/kiosk")).toBe(false);
  });
});

describe("punching while the internet is down (M4)", () => {
  const OFFLINE_SETTINGS = {
    enabled: true,
    evidence_key_id: "A",
    evidence_public_key: vector.server_public_key,
    max_items: 2000,
    max_mb: 200,
    max_hours: 72,
    cooldown_minutes: 2,
    challenge_steps: 1,
    sync_max_items: 20,
    sync_max_bytes: 1_048_576,
  };

  // A server that answers the heartbeat once (so the gate has a time anchor and the offline
  // settings) and then cannot be reached.
  function meWithOffline() {
    const base = me();
    return {
      ...base,
      time_anchor: { server_time: "2026-10-20T03:54:10Z", counter: 1, token: "anchor-token" },
      kiosk_settings: { ...base.kiosk_settings, offline: OFFLINE_SETTINGS },
    };
  }

  beforeEach(() => {
    forgetAnchorForTests();
    // Storage with room to spare for the self-check (S-38).
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: fakeGeolocation,
      storage: {
        persist: async () => true,
        estimate: async () => ({ quota: 10_000 * 1024 * 1024, usage: 0 }),
      },
    });
  });

  it("saves a card punch on the device and says SAVED, with no name and no IN or OUT", async () => {
    mockApi({ "GET /kiosk/me": { body: meWithOffline() } });
    await openPairedKiosk();
    await screen.findByText("Location good (±10 m)");
    // The punch request cannot reach the server any more: the next call has no fake answer.
    await showCard();

    expect(await screen.findByText("SAVED")).toBeInTheDocument();
    expect(screen.getByText("Saved – will be confirmed")).toBeInTheDocument();
    expect(screen.getByText(/Your punch is saved on this attendance device\./)).toBeInTheDocument();
    expect(screen.queryByText("IN")).not.toBeInTheDocument();
    expect(screen.queryByText("Sunil More")).not.toBeInTheDocument();
    expect((await queueSummary()).count).toBe(1);
    const [saved] = await oldestQueued(5, 10_000_000);
    expect(saved?.signedItem).not.toContain("UPS1"); // nothing readable is kept
  });

  it("shows the waiting count and the last-sync line after a punch was saved", async () => {
    mockApi({ "GET /kiosk/me": { body: meWithOffline() } });
    await openPairedKiosk();
    await screen.findByText("Location good (±10 m)");
    await showCard();
    await screen.findByText("SAVED");

    await waitForElementToBeRemoved(() => screen.queryByText("SAVED"), { timeout: 5000 });

    expect(await screen.findByText("1 saved")).toBeInTheDocument();
    expect(screen.getByText(/^1 punch waiting since \d\d:\d\d$/)).toBeInTheDocument();
  });

  it("keeps the honest 'NOT SAVED' message when this server has no offline mode", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();
    await showCard();

    expect(await screen.findByText("NOT SAVED")).toBeInTheDocument();
    expect(screen.getByText("No internet. Your punch was NOT saved.")).toBeInTheDocument();
    expect((await queueSummary()).count).toBe(0);
  });

  it("says NOT SAVED when the device has too little storage for offline punches", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: fakeGeolocation,
      storage: { persist: async () => false, estimate: async () => ({ quota: 10, usage: 0 }) },
    });
    mockApi({ "GET /kiosk/me": { body: meWithOffline() } });
    await openPairedKiosk();
    await screen.findByText("Location good (±10 m)");
    await showCard();

    expect(await screen.findByText("NOT SAVED")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This attendance device cannot save punches without internet. Your punch was NOT saved.",
      ),
    ).toBeInTheDocument();
    expect((await queueSummary()).count).toBe(0);
  });
});
