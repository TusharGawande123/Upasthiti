// The kiosk attendance logic without any screen (spec M2 §4.1 to §4.5, §7 rules 4, 7, 9):
// the screen state machine, the punch client with its retry and timers, the snapshot size and
// quality, the low-light hint, the card filters and the camera error mapping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import englishTexts from "../../../public/locales/en/common.json";
import { nextScreen, secondsOnScreen } from "./attendance-machine";
import { averageBrightness, LowLightWatcher } from "./brightness";
import { CameraError, startCamera } from "./camera";
import { GIVE_UP_AFTER_MS, type PunchBody, SLOW_AFTER_MS, sendPunch } from "./punch-client";
import { type PunchAnswer, resultKind } from "./punch-types";
import { isUpasthitiCard, SameCardFilter } from "./qr-reader";
import { blobToBase64, encodeWithinLimit, snapshotSize, TARGET_BYTES } from "./snapshot";

function answer(changes: Partial<PunchAnswer> = {}): PunchAnswer {
  return {
    punch_id: "p-1",
    decision: "accepted",
    direction: "in",
    employee: { display_name: "Sunil More", employee_code: "T-2041" },
    server_time: "2026-10-20T01:32:00Z",
    reason_code: null,
    message_key: "kiosk.punch.accepted.in",
    voice_key: "kiosk.voice.in",
    details: { kiosk_name: "Main gate" },
    ...changes,
  };
}

const SETTINGS = { result_seconds: 4, reject_seconds: 6 };

describe("screen state machine", () => {
  it("goes through one punch: scanning, get ready, checking, result, scanning", () => {
    let screen = nextScreen({ name: "starting" }, { type: "camera-ready" });
    expect(screen).toEqual({ name: "scanning", notACard: false });
    screen = nextScreen(screen, { type: "card-read", payload: "UPS1.A.C000001.X" });
    expect(screen).toEqual({ name: "get-ready", payload: "UPS1.A.C000001.X" });
    screen = nextScreen(screen, { type: "photo-taken" });
    expect(screen).toEqual({ name: "checking", slow: false });
    screen = nextScreen(screen, { type: "slow" });
    expect(screen).toEqual({ name: "checking", slow: true });
    screen = nextScreen(screen, { type: "answered", answer: answer() });
    expect(screen.name).toBe("result");
    screen = nextScreen(screen, { type: "screen-over" });
    expect(screen).toEqual({ name: "scanning", notACard: false });
  });

  it("goes back to scanning when the person cancels the photo", () => {
    const ready = nextScreen(
      { name: "scanning", notACard: false },
      { type: "card-read", payload: "UPS1.A.C000001.X" },
    );

    expect(nextScreen(ready, { type: "photo-cancelled" })).toEqual({
      name: "scanning",
      notACard: false,
    });
    // A cancel that arrives at any other time changes nothing.
    const checking = { name: "checking", slow: false } as const;
    expect(nextScreen(checking, { type: "photo-cancelled" })).toBe(checking);
  });

  it("reads only one card at a time", () => {
    const busy = nextScreen(
      { name: "scanning", notACard: false },
      { type: "card-read", payload: "first" },
    );

    expect(nextScreen(busy, { type: "card-read", payload: "second" })).toBe(busy);
    expect(
      nextScreen({ name: "checking", slow: false }, { type: "card-read", payload: "x" }),
    ).toEqual({ name: "checking", slow: false });
  });

  it("shows and hides the 'not an Upasthiti card' line only while scanning", () => {
    const scanning = { name: "scanning", notACard: false } as const;

    const shown = nextScreen(scanning, { type: "not-a-card" });
    expect(shown).toEqual({ name: "scanning", notACard: true });
    expect(nextScreen(shown, { type: "not-a-card-over" })).toEqual(scanning);
    expect(nextScreen({ name: "checking", slow: false }, { type: "not-a-card" }).name).toBe(
      "checking",
    );
  });

  it("handles the camera: needs a tap, then starts; or a problem", () => {
    const tap = nextScreen({ name: "starting" }, { type: "camera-needs-tap" });
    expect(tap).toEqual({ name: "needs-tap" });
    expect(nextScreen(tap, { type: "camera-ready" }).name).toBe("scanning");
    expect(
      nextScreen({ name: "starting" }, { type: "camera-failed", code: "CAMERA_BLOCKED" }),
    ).toEqual({
      name: "camera-problem",
      code: "CAMERA_BLOCKED",
    });
  });

  it("shows a failure and goes back to scanning afterwards", () => {
    const failed = nextScreen(
      { name: "checking", slow: true },
      { type: "failed", code: "NETWORK_OFFLINE" },
    );

    expect(failed).toEqual({ name: "failed", code: "NETWORK_OFFLINE" });
    expect(nextScreen(failed, { type: "screen-over" }).name).toBe("scanning");
  });

  it("keeps rejections and the self test longer than IN, OUT and 'already'", () => {
    const shown = (a: PunchAnswer) => secondsOnScreen({ name: "result", answer: a }, SETTINGS);

    expect(shown(answer())).toBe(4);
    expect(shown(answer({ direction: "out" }))).toBe(4);
    expect(
      shown(answer({ decision: "rejected", direction: null, reason_code: "COOLDOWN_ACTIVE" })),
    ).toBe(4);
    expect(
      shown(answer({ decision: "rejected", direction: null, reason_code: "QR_REVOKED" })),
    ).toBe(6);
    expect(shown(answer({ decision: "self_test", direction: null }))).toBe(6);
    expect(secondsOnScreen({ name: "failed", code: "NETWORK_OFFLINE" }, SETTINGS)).toBe(6);
    expect(secondsOnScreen({ name: "scanning", notACard: false }, SETTINGS)).toBeNull();
  });

  it("names the kind of each result", () => {
    expect(resultKind(answer())).toBe("in");
    expect(resultKind(answer({ direction: "out" }))).toBe("out");
    expect(resultKind(answer({ decision: "rejected", reason_code: "OUT_TOO_SOON" }))).toBe(
      "already",
    );
    expect(resultKind(answer({ decision: "rejected", reason_code: "WRONG_PLANT" }))).toBe(
      "rejected",
    );
    expect(resultKind(answer({ decision: "self_test" }))).toBe("self-test");
  });
});

describe("punch client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const input = { qrPayload: "UPS1.A.C000001.X", snapshotBase64: "AAAA", location: null };

  it("sends one punch with a fresh id and returns the answer", async () => {
    const sent: PunchBody[] = [];
    const outcome = await sendPunch(input, {
      send: async (body) => {
        sent.push(body);
        return answer();
      },
    });

    expect(outcome).toEqual({ kind: "answer", answer: answer() });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "qr",
      qr_payload: input.qrPayload,
      snapshot_jpeg: "AAAA",
    });
    expect(sent[0]?.client_punch_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    new ApiError("NETWORK_ERROR", "", 0),
    new ApiError("NONCE_REUSED", "", 401),
    new ApiError("INTERNAL_ERROR", "", 500),
  ])("retries once with the SAME scan id after %s", async (firstError) => {
    const sent: PunchBody[] = [];
    let calls = 0;
    const outcome = await sendPunch(input, {
      send: async (body) => {
        sent.push(body);
        calls += 1;
        if (calls === 1) throw firstError;
        return answer();
      },
    });

    expect(outcome.kind).toBe("answer");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.client_punch_id).toBe(sent[0]?.client_punch_id);
  });

  it("says NETWORK_OFFLINE when both tries fail without a connection", async () => {
    const outcome = await sendPunch(input, {
      send: async () => {
        throw new ApiError("NETWORK_ERROR", "", 0);
      },
    });

    expect(outcome).toEqual({ kind: "failed", code: "NETWORK_OFFLINE" });
  });

  it.each([
    ["TOO_MANY_REQUESTS", 429, "TOO_MANY_REQUESTS"],
    ["PAYLOAD_TOO_LARGE", 413, "PAYLOAD_TOO_LARGE"],
    ["DEVICE_REVOKED", 403, "DEVICE_REVOKED"],
    ["VALIDATION_FAILED", 422, "INTERNAL_ERROR"],
  ])("does not retry %s and shows %s", async (code, status, shown) => {
    let calls = 0;
    const outcome = await sendPunch(input, {
      send: async () => {
        calls += 1;
        throw new ApiError(code, "", status);
      },
    });

    expect(calls).toBe(1);
    expect(outcome).toEqual({ kind: "failed", code: shown });
  });

  it("says the server is starting after 5 s and gives up after 60 s", async () => {
    const onSlow = vi.fn();
    const pending = sendPunch(input, { onSlow, send: () => new Promise(() => {}) });

    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS - 1);
    expect(onSlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GIVE_UP_AFTER_MS);

    await expect(pending).resolves.toEqual({ kind: "failed", code: "SERVER_NO_ANSWER" });
  });

  it("does not call 'slow' when the answer comes quickly", async () => {
    const onSlow = vi.fn();

    await sendPunch(input, { onSlow, send: async () => answer() });
    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS * 2);

    expect(onSlow).not.toHaveBeenCalled();
  });
});

describe("snapshot", () => {
  it("is 320 px wide and keeps the camera's shape within the server's limits", () => {
    expect(snapshotSize(1280, 960)).toEqual({ width: 320, height: 240 });
    expect(snapshotSize(1280, 720)).toEqual({ width: 320, height: 180 });
    expect(snapshotSize(720, 1280)).toEqual({ width: 320, height: 569 });
    expect(snapshotSize(320, 2000)).toEqual({ width: 320, height: 640 });
    expect(snapshotSize(3000, 100)).toEqual({ width: 320, height: 120 });
  });

  it("lowers the quality step by step until the file fits in 15 KB", async () => {
    const tried: number[] = [];
    const sizes: Record<number, number> = { 0.8: 30_000, 0.7: 22_000, 0.6: TARGET_BYTES - 1 };

    const blob = await encodeWithinLimit(async (quality) => {
      tried.push(quality);
      return new Blob([new Uint8Array(sizes[quality] ?? 1)]);
    });

    expect(tried).toEqual([0.8, 0.7, 0.6]);
    expect(blob.size).toBe(TARGET_BYTES - 1);
  });

  it("never goes below quality 0.4 and then sends what it has", async () => {
    const tried: number[] = [];

    const blob = await encodeWithinLimit(async (quality) => {
      tried.push(quality);
      return new Blob([new Uint8Array(20_000)]);
    });

    expect(tried).toEqual([0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(blob.size).toBe(20_000);
  });

  it("turns the file into base64 text without a data: prefix", async () => {
    const text = await blobToBase64(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])]));

    expect(text).toBe("/9j/AA==");
  });
});

describe("low-light hint", () => {
  it("measures brightness like the server (ITU-R 601 weights)", () => {
    expect(averageBrightness(new Uint8ClampedArray([255, 255, 255, 255]))).toBe(255);
    expect(averageBrightness(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]))).toBe(128);
    expect(averageBrightness(new Uint8ClampedArray([255, 0, 0, 255]))).toBe(76);
    expect(averageBrightness(new Uint8ClampedArray([]))).toBe(0);
  });

  it("appears only after 10 s of darkness and hides as soon as it is bright", () => {
    const watcher = new LowLightWatcher(40);

    expect(watcher.update(20, 0)).toBe(false);
    expect(watcher.update(20, 9_999)).toBe(false);
    expect(watcher.update(20, 10_000)).toBe(true);
    expect(watcher.update(60, 11_000)).toBe(false);
    expect(watcher.update(20, 12_000)).toBe(false); // the 10 s start again
    expect(watcher.update(40, 30_000)).toBe(false); // exactly at the threshold is not dark
  });
});

describe("card filters", () => {
  it("only sends Upasthiti cards", () => {
    expect(isUpasthitiCard("UPS1.A.C000123.ABC")).toBe(true);
    expect(isUpasthitiCard("upi://pay?pa=shop@bank")).toBe(false);
    expect(isUpasthitiCard("UPS2.A.C000123")).toBe(false);
  });

  it("ignores the same card for 5 s after its result, but not another card", () => {
    const filter = new SameCardFilter();
    filter.remember("UPS1.card-a", 1_000);

    expect(filter.shouldIgnore("UPS1.card-a", 5_999)).toBe(true);
    expect(filter.shouldIgnore("UPS1.card-a", 6_000)).toBe(false);
    expect(filter.shouldIgnore("UPS1.card-b", 2_000)).toBe(false);
  });
});

describe("camera", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCamera(getUserMedia: () => Promise<MediaStream>) {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
  }

  async function problemOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "none";
    } catch (error) {
      return error instanceof CameraError ? error.problem : "other";
    }
  }

  it.each([
    ["NotAllowedError", "CAMERA_BLOCKED"],
    ["SecurityError", "CAMERA_BLOCKED"],
    ["NotFoundError", "CAMERA_NOT_FOUND"],
    ["NotReadableError", "CAMERA_NOT_FOUND"],
  ])("turns %s into %s", async (name, problem) => {
    stubCamera(() => Promise.reject(new DOMException("no", name)));

    expect(await problemOf(startCamera(document.createElement("video")))).toBe(problem);
  });

  it("asks for a tap when the browser will not play the picture by itself", async () => {
    stubCamera(() => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream));
    const video = document.createElement("video");
    video.play = () => Promise.reject(new DOMException("gesture", "NotAllowedError"));

    expect(await problemOf(startCamera(video))).toBe("NEEDS_TAP");
    expect(video.srcObject).not.toBeNull();
  });

  it("says not found when the browser has no camera support at all", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });

    expect(await problemOf(startCamera(document.createElement("video")))).toBe("CAMERA_NOT_FOUND");
  });
});

describe("kiosk texts", () => {
  // Every decision code the server can send (backend app/antiproxy, spec §7 rule 10).
  const SERVER_CODES = [
    "SNAPSHOT_MISSING",
    "SNAPSHOT_INVALID",
    "QR_FORMAT_INVALID",
    "QR_SIGNATURE_INVALID",
    "QR_REVOKED",
    "QR_NOT_YET_VALID",
    "QR_EXPIRED",
    "EMPLOYEE_INACTIVE",
    "EMPLOYEE_NOT_QR",
    "WRONG_PLANT",
    "COOLDOWN_ACTIVE",
    "OUT_TOO_SOON",
    "QR_SIGNING_NOT_CONFIGURED",
  ];

  it.each(SERVER_CODES)("%s has a title, message, next step and spoken line", (code) => {
    const texts = (englishTexts.kiosk.punch as Record<string, Record<string, unknown>>)[code];

    for (const part of ["title", "message", "next", "voice"]) {
      expect(texts?.[part], `${code}.${part}`).toBeTruthy();
    }
  });

  it("never puts a name into a spoken line", () => {
    const punch = englishTexts.kiosk.punch as Record<string, Record<string, unknown>>;
    const spoken = [
      ...Object.values(englishTexts.kiosk.voice),
      ...Object.values(punch).map((texts) => String(texts.voice ?? "")),
    ];

    expect(spoken.filter((line) => line.includes("{{name}}"))).toEqual([]);
  });
});
