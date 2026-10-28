// The face punch on the gate screen (spec M3 §4.1 to §4.6, design gate A; AC-13 to AC-16, AC-28).
// The camera, the QR decoder, MediaPipe and the pictures are fakes; the screens, the timers, the
// signed requests and the texts are the real ones. The fake MediaPipe reports the faces the test
// sets, so the test "turns its head" by changing them.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Measure } from "@/lib/face-guide/pose-estimate";
import { fakeGeolocation, resetFakeReading } from "@/test/fake-geolocation";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { createDeviceKey } from "../device-key";
import { forgetDevice, saveDevice } from "../device-store";
import { DEFAULT_SCREEN_SETTINGS, type PunchAnswer } from "./punch-types";

const fakes = vi.hoisted(() => ({
  /** The faces the fake MediaPipe sees right now (null: MediaPipe could not load). */
  faces: [] as Measure[],
  guideLoads: true,
}));

vi.mock("./camera", async (importOriginal) => {
  const real = await importOriginal<typeof import("./camera")>();
  return {
    ...real,
    countCameras: async () => 1,
    startCamera: async (video: HTMLVideoElement) => {
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      return { getTracks: () => [] } as unknown as MediaStream;
    },
  };
});

vi.mock("./qr-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./qr-reader")>()),
  createQrDetector: async () => ({ usesFallback: false, detect: async () => null }),
}));

vi.mock("./face-capture", () => ({ takeFaceFrame: async () => "RkFDRQ==" }));

vi.mock("@/lib/face-guide/landmarker", () => ({
  loadFaceGuide: async () =>
    fakes.guideLoads ? { read: () => fakes.faces, close: () => undefined } : null,
}));

const KIOSK_ID = "11111111-2222-3333-4444-555555555555";
const STRAIGHT: Measure = {
  turn: 0,
  noseHeight: 0.5,
  faceSize: 0.25,
  centre: { x: 0.5, y: 0.45 },
};
const TURNED_LEFT: Measure = { ...STRAIGHT, turn: 0.6 };

const CHALLENGE = {
  challenge_nonce: "n".repeat(22),
  challenge: "turn_left",
  expires_at: "2026-10-24T01:32:10Z",
  server_time: "2026-10-24T01:32:00Z",
  capture: {
    min_frames: 2,
    max_frames: 4,
    max_width: 640,
    max_height: 480,
    max_frame_bytes: 70000,
    min_yaw_degrees: 18,
  },
};

const CODE_ENTRY = { token: "t".repeat(43), expires_at: "2099-01-01T00:00:00Z", tries_left: 2 };

function me(face: Record<string, unknown> = {}) {
  return {
    kiosk_id: KIOSK_ID,
    kiosk_name: "Main gate phone",
    status: "active",
    plant: { id: "p-1", name: "Sheet Shapers", code: "K134" },
    server_time: "2026-10-24T01:32:00Z",
    notices: [],
    kiosk_settings: {
      voice_enabled: false,
      sound_enabled: false,
      result_seconds: 1,
      reject_seconds: 1,
      photo_ready_seconds: 20,
      snapshot_retention_days: 60,
      dark_threshold: 40,
      face: {
        ...DEFAULT_SCREEN_SETTINGS.face,
        available: true,
        state: "ready",
        enabled_for_plant: true,
        ...face,
      },
    },
  };
}

function answer(changes: Partial<PunchAnswer> = {}): PunchAnswer {
  return {
    punch_id: "p-1",
    decision: "accepted",
    direction: "in",
    employee: { display_name: "Sunil More", employee_code: "T-2041" },
    server_time: "2026-10-24T01:32:00Z",
    reason_code: null,
    message_key: "kiosk.punch.accepted.in",
    voice_key: "kiosk.voice.in",
    details: { kiosk_name: "Main gate phone" },
    ...changes,
  };
}

const NEEDS_CODE = answer({
  decision: "needs_code",
  direction: null,
  employee: null,
  reason_code: "NEED_EMPLOYEE_CODE",
  code_entry: CODE_ENTRY,
});

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

/** Taps the button, keeps a good face in the oval and turns the head when asked. */
async function faceUntilChecking() {
  fakes.faces = [STRAIGHT];
  await userEvent.click(await screen.findByRole("button", { name: /Punch with face/ }));
  await screen.findByText("Turn your head to your", { exact: false }, { timeout: 4000 });
  fakes.faces = [TURNED_LEFT];
  await screen.findByText("Now look straight again.", {}, { timeout: 4000 });
  fakes.faces = [STRAIGHT];
}

beforeEach(async () => {
  await forgetDevice();
  fakes.faces = [];
  fakes.guideLoads = true;
  localStorage.clear();
  resetFakeReading();
  vi.stubGlobal("navigator", { ...navigator, geolocation: fakeGeolocation });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Punch with face button", () => {
  it("is shown when someone at this plant is enrolled and the face service is ready", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();

    expect(await screen.findByRole("button", { name: /Punch with face/ })).toBeEnabled();
    expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument();
  });

  it("is hidden when nobody at this plant has a face", async () => {
    mockApi({ "GET /kiosk/me": { body: me({ enabled_for_plant: false }) } });
    await openPairedKiosk();

    expect(screen.queryByRole("button", { name: /Punch with face/ })).not.toBeInTheDocument();
    expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument();
  });

  it("is greyed with the reason while the face service starts or is not available", async () => {
    mockApi({ "GET /kiosk/me": { body: me({ state: "loading" }) } });
    await openPairedKiosk();
    const starting = await screen.findByRole("button", { name: /Punch with face/ });
    expect(starting).toBeDisabled();
    expect(starting).toHaveTextContent("Face punch is starting…");
  });

  it("says the face punch is not available when the server cannot run it", async () => {
    mockApi({ "GET /kiosk/me": { body: me({ available: false, state: "off" }) } });
    await openPairedKiosk();
    expect(await screen.findByRole("button", { name: /Punch with face/ })).toHaveTextContent(
      "Face punch is not available right now",
    );
  });
});

describe("a face punch", () => {
  it("guides the face, asks for a head turn, sends three pictures and shows IN", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/challenge": { body: CHALLENGE },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    await faceUntilChecking();

    expect(await screen.findByText("Sunil More", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Employee code T-2041 · Checked in")).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/punch/kiosk")?.body as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({ method: "face", challenge_nonce: CHALLENGE.challenge_nonce });
    expect((sent.frames as { role: string }[]).map((frame) => frame.role)).toEqual([
      "frontal",
      "turn",
      "frontal",
    ]);
  });

  it("can be cancelled while the face is being guided, and nothing is sent", async () => {
    const calls = mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();
    await userEvent.click(await screen.findByRole("button", { name: /Punch with face/ }));
    await screen.findByText("Look at the camera. Keep your face inside the oval.");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Show your ID card to the camera")).toBeInTheDocument();
    expect(calls.map((call) => call.path)).not.toContain("/punch/challenge");
  });

  it("tells the person what to change while no good face is in the oval", async () => {
    mockApi({ "GET /kiosk/me": { body: me() } });
    await openPairedKiosk();
    fakes.faces = [{ ...STRAIGHT, faceSize: 0.05 }];

    await userEvent.click(await screen.findByRole("button", { name: /Punch with face/ }));

    expect(await screen.findByText("Come closer")).toBeInTheDocument();
  });

  it("offers Try again when the face could not be seen, and starts the guidance again", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/challenge": { body: CHALLENGE },
      "POST /punch/kiosk": {
        body: answer({
          decision: "rejected",
          direction: null,
          employee: null,
          reason_code: "NO_FACE",
          details: { kiosk_name: "Main gate phone", retry_allowed: true },
        }),
      },
    });
    await openPairedKiosk();
    await faceUntilChecking();

    expect(await screen.findByText("NOT ACCEPTED", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("We could not see your face.")).toBeInTheDocument();
    expect(screen.getByText("NO_FACE")).toBeInTheDocument();
    expect(screen.queryByText("Sunil More")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Look at the camera. Keep your face inside the oval."),
    ).toBeInTheDocument();
  });

  it("asks the person to wait when the face service is busy (amber, no Try again)", async () => {
    mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/challenge": apiError(503, "FACE_SERVICE_BUSY"),
    });
    await openPairedKiosk();
    fakes.faces = [STRAIGHT];

    await userEvent.click(await screen.findByRole("button", { name: /Punch with face/ }));

    expect(await screen.findByText("PLEASE WAIT", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Many people are punching.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("uses the timed capture when MediaPipe cannot load", async () => {
    fakes.guideLoads = false;
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/challenge": { body: CHALLENGE },
      "POST /punch/kiosk": { body: answer() },
    });
    await openPairedKiosk();

    await userEvent.click(await screen.findByRole("button", { name: /Punch with face/ }));

    expect(await screen.findByText("Sunil More", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toContain("/punch/kiosk");
  });
});

describe("the employee code pad", () => {
  async function openCodePad(extra: Record<string, unknown> = {}) {
    const calls = mockApi({
      "GET /kiosk/me": { body: me(extra) },
      "POST /punch/challenge": { body: CHALLENGE },
      "POST /punch/kiosk": { body: NEEDS_CODE },
      "POST /punch/kiosk/code": { body: answer() },
    });
    await openPairedKiosk();
    await faceUntilChecking();
    await screen.findByRole("heading", { name: "Type your employee code" }, { timeout: 4000 });
    return calls;
  }

  it("opens when the server is unsure, never shows a name, and accepts a typed code", async () => {
    const calls = await openCodePad();
    expect(screen.getByText("We could not be sure it is you.")).toBeInTheDocument();
    expect(screen.queryByText("Sunil More")).not.toBeInTheDocument();

    for (const digit of ["1", "0", "4", "3"]) {
      await userEvent.click(screen.getByRole("button", { name: digit }));
    }
    expect(screen.getByLabelText("Employee code typed so far")).toHaveTextContent("1043");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findByText("Sunil More", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/punch/kiosk/code")?.body).toMatchObject({
      code_entry_token: CODE_ENTRY.token,
      employee_code: "1043",
    });
  });

  it("switches to letters and offers the plant's common code starts as keys", async () => {
    await openCodePad({ code_prefixes: ["EMP-", "T-"] });

    await userEvent.click(screen.getByRole("button", { name: "EMP-" }));
    await userEvent.click(screen.getByRole("button", { name: "ABC" }));
    await userEvent.click(screen.getByRole("button", { name: "Q" }));
    await userEvent.click(screen.getByRole("button", { name: "123" }));
    await userEvent.click(screen.getByRole("button", { name: "7" }));

    expect(screen.getByLabelText("Employee code typed so far")).toHaveTextContent("EMP-Q7");
  });

  it("keeps the typed code and says how many tries are left after a wrong code", async () => {
    const calls = mockApi({
      "GET /kiosk/me": { body: me() },
      "POST /punch/challenge": { body: CHALLENGE },
      "POST /punch/kiosk": { body: NEEDS_CODE },
      "POST /punch/kiosk/code": {
        body: answer({
          decision: "needs_code",
          direction: null,
          employee: null,
          reason_code: "CODE_NOT_MATCHED",
          code_entry: { ...CODE_ENTRY, tries_left: 1 },
        }),
      },
    });
    await openPairedKiosk();
    await faceUntilChecking();
    await screen.findByRole("heading", { name: "Type your employee code" }, { timeout: 4000 });

    await userEvent.click(screen.getByRole("button", { name: "9" }));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(
      await screen.findByText(/That code does not match your face/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 try left")).toBeInTheDocument();
    expect(screen.getByLabelText("Employee code typed so far")).toHaveTextContent("9");
    expect(calls.filter((call) => call.path === "/punch/kiosk/code")).toHaveLength(1);
  });

  it("goes back to scanning when the person cancels", async () => {
    await openCodePad();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByText("Show your ID card to the camera")).toBeInTheDocument(),
    );
  });
});
