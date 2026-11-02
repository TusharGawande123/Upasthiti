// The camera flows of the phone (M4b P4): the face punch, the gate-code punch, the face proof and
// the card proof of the password setup, and passkey sign-in. The camera, the face guide (MediaPipe)
// and the QR decoder are fakes, so the head-turn runs on its timed fallback (about 3 s); location
// answers a little later like a real browser. Screens, requests and texts are the real ones.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGeolocation, fakeReading, resetFakeReading } from "../../test/fake-geolocation";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const fakes = vi.hoisted(() => ({
  qrText: null as string | null,
  camera: "ok" as "ok" | "blocked" | "needs-tap",
  started: [] as string[],
}));

vi.mock("@/kiosk/attendance/camera", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/kiosk/attendance/camera")>();
  return {
    ...real,
    startCamera: async (video: HTMLVideoElement, facing = "user") => {
      fakes.started.push(facing);
      Object.defineProperty(video, "readyState", { value: 4, configurable: true });
      if (fakes.camera === "blocked") throw new real.CameraError("CAMERA_BLOCKED");
      if (fakes.camera === "needs-tap") throw new real.CameraError("NEEDS_TAP");
      return { getTracks: () => [] } as unknown as MediaStream;
    },
    playAfterTap: async () => {},
  };
});
vi.mock("@/kiosk/attendance/qr-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/kiosk/attendance/qr-reader")>()),
  createQrDetector: async () => ({ usesFallback: false, detect: async () => fakes.qrText }),
}));
vi.mock("@/kiosk/attendance/face-capture", () => ({ takeFaceFrame: async () => "AAAA" }));
vi.mock("@/kiosk/attendance/snapshot", () => ({ takeSnapshot: async () => "/9j/AA==" }));
vi.mock("@/lib/face-guide/landmarker", () => ({ loadFaceGuide: async () => null }));

const ME = {
  employee: {
    code: "E0412",
    name: "Sunita Jadhav",
    first_name: "Sunita",
    plant: { id: "p-1", code: "K134", name: "Sheet Shapers Waluj" },
    punch_method: "face",
  },
  access: { outside_work_allowed: false, outside_work_until: null },
  notice: { required: false, version: "1" },
  ready: { face: true },
  passkeys: [],
  today: { last_punch: null },
  settings: {
    gps_accuracy_limit_m: 50,
    location_max_age_seconds: 60,
    challenge_seconds: 10,
    photo_ready_seconds: 20,
    capture: {},
  },
  geofence: null,
};

function challenge(extra: object = {}) {
  const now = Date.now();
  return {
    challenge_nonce: "nonce-1",
    challenge: "turn_left",
    expires_at: new Date(now + 20_000).toISOString(),
    server_time: new Date(now).toISOString(),
    capture: {
      min_frames: 2,
      max_frames: 4,
      max_width: 640,
      max_height: 480,
      max_frame_bytes: 70000,
      min_yaw_degrees: 18,
    },
    ...extra,
  };
}

const ACCEPTED = {
  punch_id: "p-9",
  decision: "accepted",
  reason_code: null,
  direction: "in",
  punch_time: "2026-11-02T01:32:00Z",
  outside_plant: false,
  details: {},
};

function setBrowser() {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
  fakeGeolocation.watchPosition.mockImplementation(
    (success: PositionCallback, failure?: PositionErrorCallback | null) => {
      setTimeout(() => {
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
      }, 0);
      return 1;
    },
  );
}

beforeEach(() => {
  fakes.qrText = null;
  fakes.camera = "ok";
  fakes.started = [];
  resetFakeReading();
  setBrowser();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "PublicKeyCredential");
});

describe("phone face punch", () => {
  it("reads the location, runs the head turn and shows IN with the plant", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: ME },
      "POST /phone/punch/challenge": () => ({ body: challenge() }),
      "POST /phone/punch/face": { body: ACCEPTED },
    });
    renderRoute("/phone/punch/face");

    expect(await screen.findByText("IN", {}, { timeout: 12_000 })).toBeInTheDocument();
    expect(screen.getByText("Sheet Shapers Waluj")).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/phone/punch/face")?.body as {
      frames: { role: string }[];
      location: { accuracy_m: number; age_s: number };
      challenge_nonce: string;
      client_punch_id: string;
    };
    expect(sent.challenge_nonce).toBe("nonce-1");
    expect(sent.frames.map((frame) => frame.role)).toEqual(["frontal", "turn", "frontal"]);
    expect(sent.location).toMatchObject({ accuracy_m: 10, age_s: 0 });
    expect(sent.client_punch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fakes.started).toEqual(["user"]);
  }, 20_000);

  it("shows a refusal with Try again for a head turn that was not seen", async () => {
    mockApi({
      "GET /phone/me": { body: ME },
      "POST /phone/punch/challenge": () => ({ body: challenge() }),
      "POST /phone/punch/face": {
        body: {
          ...ACCEPTED,
          decision: "rejected",
          reason_code: "LIVENESS_FAILED",
          direction: null,
          details: { retry_allowed: true },
        },
      },
    });
    renderRoute("/phone/punch/face");
    expect(
      await screen.findByText(
        "Please turn your head as the arrow shows, then look straight.",
        {},
        { timeout: 12_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  }, 20_000);

  it("with no internet shows NOT saved and writes nothing on the phone (AC-48)", async () => {
    // The phone is online-only: nothing is queued in localStorage or IndexedDB (spec M4b AC-48).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/phone/me") return Response.json(ME);
        throw new TypeError("Failed to fetch");
      }),
    );
    const storedBefore = JSON.stringify({ ...localStorage });
    const databasesBefore = (await indexedDB.databases()).length;
    renderRoute("/phone/punch/face");

    expect(
      await screen.findByText("No internet. Your punch was NOT saved.", {}, { timeout: 12_000 }),
    ).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage })).toBe(storedBefore);
    expect((await indexedDB.databases()).length).toBe(databasesBefore);
  }, 20_000);

  it("explains a refused location permission before the camera opens", async () => {
    fakeReading.denied = true;
    mockApi({ "GET /phone/me": { body: ME } });
    renderRoute("/phone/punch/face");
    expect(await screen.findByText("Turn on location for this website.")).toBeInTheDocument();
    expect(fakes.started).toEqual([]);
  });

  it("explains a blocked camera with the steps", async () => {
    fakes.camera = "blocked";
    mockApi({ "GET /phone/me": { body: ME } });
    renderRoute("/phone/punch/face");
    expect(await screen.findByText("Camera is blocked")).toBeInTheDocument();
    expect(screen.getByText("Allow the camera for this site.")).toBeInTheDocument();
    expect(screen.getByText("Set Camera to “Allow”.")).toBeInTheDocument();
  });

  it("sends the person to the notice when it was not accepted", async () => {
    mockApi({
      "GET /phone/me": { body: ME },
      "POST /phone/punch/challenge": apiError(428, "PHONE_NOTICE_REQUIRED"),
      "GET /phone/notice": { hang: true },
    });
    const router = renderRoute("/phone/punch/face");
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/notice"), {
      timeout: 8000,
    });
  });
});

describe("phone gate-code punch", () => {
  const QR_ME = { ...ME, employee: { ...ME.employee, punch_method: "qr" } };

  it("scans the gate code, takes the photo when the person is ready and shows OUT", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: QR_ME },
      "POST /phone/punch/gate-code": { body: { ...ACCEPTED, direction: "out" } },
    });
    const user = userEvent.setup();
    renderRoute("/phone/punch/gate-code");
    // A code that is not the gate's gets a clear message and is never sent.
    fakes.qrText = "https://example.com/not-ours";
    expect(
      await screen.findByText("This is not the phone code of the attendance device."),
    ).toBeInTheDocument();
    fakes.qrText = "UPG1.device.1700000000.mac";
    await user.click(await screen.findByRole("button", { name: /I'm ready/ }));

    expect(await screen.findByText("OUT")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/phone/punch/gate-code")?.body).toMatchObject({
      gate_code: "UPG1.device.1700000000.mac",
      photo_jpeg: "/9j/AA==",
      location: { accuracy_m: 10 },
    });
    expect(fakes.started).toEqual(["environment", "user"]);
  });

  it("shows the refusal of a code that has changed", async () => {
    mockApi({
      "GET /phone/me": { body: QR_ME },
      "POST /phone/punch/gate-code": {
        body: {
          ...ACCEPTED,
          decision: "rejected",
          reason_code: "GATE_CODE_EXPIRED",
          direction: null,
        },
      },
    });
    const user = userEvent.setup();
    renderRoute("/phone/punch/gate-code");
    fakes.qrText = "UPG1.device.1.mac";
    await user.click(await screen.findByRole("button", { name: /I'm ready/ }));
    expect(await screen.findByText("The phone code has changed.")).toBeInTheDocument();
    expect(screen.getByText("Please scan the code again.")).toBeInTheDocument();
  });
});

describe("password setup: prove it is you", () => {
  it("proves by face and goes to the password step", async () => {
    const calls = mockApi({
      "POST /phone/proof/face/challenge": () => ({ body: { ...challenge(), proof_id: "proof-1" } }),
      "POST /phone/proof/face": {
        body: {
          proof_token: "t".repeat(43),
          expires_at: "2026-11-02T04:35:00Z",
          employee: { code: "E0412", first_name: "Sunita" },
        },
      },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Check my face/ }));
    await user.type(screen.getByLabelText("Employee code"), "e0412");
    await user.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/setup/password"), {
      timeout: 12_000,
    });
    expect(router.state.location.state).toMatchObject({
      proofToken: "t".repeat(43),
      firstName: "Sunita",
      employeeCode: "E0412",
    });
    const sent = calls.find((call) => call.path === "/phone/proof/face")?.body as {
      proof_id: string;
    };
    expect(sent.proof_id).toBe("proof-1");
    expect(calls.find((call) => call.path === "/phone/proof/face/challenge")?.body).toEqual({
      employee_code: "E0412",
    });
  }, 20_000);

  it("shows one answer for every 'not you' case", async () => {
    mockApi({
      "POST /phone/proof/face/challenge": () => ({ body: { ...challenge(), proof_id: "proof-1" } }),
      "POST /phone/proof/face": apiError(401, "PROOF_FAILED"),
    });
    const user = userEvent.setup();
    renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Check my face/ }));
    await user.type(screen.getByLabelText("Employee code"), "E1");
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    expect(
      await screen.findByText("We could not confirm it is you.", {}, { timeout: 12_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Please try again, or visit the plant office.")).toBeInTheDocument();
  }, 20_000);

  it("proves by ID card: says location is needed first, then reads the card", async () => {
    const calls = mockApi({
      "POST /phone/proof/card": {
        body: {
          proof_token: "c".repeat(43),
          expires_at: "2026-11-02T04:35:00Z",
          employee: { code: "T0877", first_name: "Ramesh" },
        },
      },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Scan my ID card/ }));
    expect(screen.getByText("Location is needed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Camera picture for your ID card");
    fakes.qrText = "UPS1.A.C000123.SIG";
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/setup/password"));
    expect(calls.find((call) => call.path === "/phone/proof/card")?.body).toMatchObject({
      qr_payload: "UPS1.A.C000123.SIG",
      location: { accuracy_m: 10 },
    });
    expect(fakes.started).toEqual(["environment"]);
  });

  it("says in plain words to wait when the card proof is asked too often (429)", async () => {
    mockApi({ "POST /phone/proof/card": apiError(429, "TOO_MANY_REQUESTS") });
    const user = userEvent.setup();
    renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Scan my ID card/ }));
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Camera picture for your ID card");
    fakes.qrText = "UPS1.A.C000123.SIG";
    expect(await screen.findByText("Wait a moment, then try again.")).toBeInTheDocument();
    expect(screen.getByText("PLEASE WAIT")).toBeInTheDocument();
  });

  it("refuses a card read outside the plant without a retry button", async () => {
    mockApi({ "POST /phone/proof/card": apiError(422, "OUTSIDE_GEOFENCE") });
    const user = userEvent.setup();
    renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Scan my ID card/ }));
    await user.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByLabelText("Camera picture for your ID card");
    fakes.qrText = "UPS1.A.C000123.SIG";
    expect(await screen.findByText("You are not at the plant.")).toBeInTheDocument();
    expect(screen.getByText("Please visit the plant office.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("goes back to the choice from the face step", async () => {
    mockApi({});
    const user = userEvent.setup();
    renderRoute("/phone/setup");
    await user.click(await screen.findByRole("button", { name: /Check my face/ }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Scan my ID card/ })).toBeInTheDocument();
  });
});

describe("passkey sign in", () => {
  it("signs in with the phone's screen lock", async () => {
    const bytes = (...values: number[]) => new Uint8Array(values).buffer;
    const credential = {
      id: "cred-1",
      rawId: bytes(1, 2, 3),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bytes(4, 5),
        authenticatorData: bytes(6, 7),
        signature: bytes(8, 9),
        userHandle: bytes(10),
      },
    };
    Object.defineProperty(window, "PublicKeyCredential", {
      value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
      configurable: true,
    });
    const get = vi.fn(async () => credential);
    Object.defineProperty(navigator, "credentials", {
      value: { get, create: vi.fn() },
      configurable: true,
    });
    const calls = mockApi({
      "POST /phone/passkeys/login/options": {
        body: {
          options: { challenge: "AQID", allowCredentials: [{ id: "AQID", type: "public-key" }] },
        },
      },
      "POST /phone/passkeys/login": { body: { employee: ME.employee, notice_required: false } },
      "GET /phone/me": { body: ME },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone/login");
    await user.type(await screen.findByLabelText("Employee code"), "e0412");
    await user.click(await screen.findByRole("button", { name: "Sign in with passkey" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone"));
    expect(get).toHaveBeenCalled();
    const body = calls.find((call) => call.path === "/phone/passkeys/login")?.body as {
      employee_code: string;
      credential: { id: string; rawId: string; response: { signature: string } };
    };
    expect(body.employee_code).toBe("E0412");
    expect(body.credential).toMatchObject({ id: "cred-1", rawId: "AQID" });
    expect(body.credential.response.signature).toBe("CAk");
  });

  it("says so when the person closes the screen-lock prompt", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
      configurable: true,
    });
    Object.defineProperty(navigator, "credentials", {
      value: { get: vi.fn(async () => null), create: vi.fn() },
      configurable: true,
    });
    mockApi({
      "POST /phone/passkeys/login/options": { body: { options: { challenge: "AQID" } } },
    });
    const user = userEvent.setup();
    renderRoute("/phone/login");
    await user.type(await screen.findByLabelText("Employee code"), "E1");
    await user.click(await screen.findByRole("button", { name: "Sign in with passkey" }));
    expect(
      await screen.findByText(
        "The passkey was not used. You can try again or sign in with your password.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for the employee code first", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
      configurable: true,
    });
    mockApi({});
    const user = userEvent.setup();
    renderRoute("/phone/login");
    await user.click(await screen.findByRole("button", { name: "Sign in with passkey" }));
    expect(await screen.findByText("Please type your employee code.")).toBeInTheDocument();
  });
});
