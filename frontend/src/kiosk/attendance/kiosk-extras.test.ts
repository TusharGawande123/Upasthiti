// Tones, voice, the screen-awake lock, problem reports and the self-update (spec M2 §7 rules 9,
// 13, 16; F-1, S-26, S-27, S-29; AC-29, AC-44, AC-45), each with fake browser features.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendanceScreen } from "./attendance-machine";
import {
  cleanMessage,
  ErrorReporter,
  MAX_REPORTS_PER_HOUR,
  type ReportBody,
} from "./error-reporter";
import { feedbackFor } from "./feedback";
import type { PunchAnswer } from "./punch-types";
import { IDLE_BEFORE_RELOAD_MS, newVersionIsLive, readyToReload } from "./self-update";
import { TONES, TonePlayer } from "./sound";
import { pickVoice, VoicePlayer } from "./voice";
import { WakeLockKeeper } from "./wake-lock";

afterEach(() => {
  vi.unstubAllGlobals();
});

function result(changes: Partial<PunchAnswer> = {}): AttendanceScreen {
  return {
    name: "result",
    answer: {
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
    },
  };
}

// --- A fake Web Audio API ------------------------------------------------------------------------

function stubAudio(startState: "running" | "suspended") {
  const oscillators: number[] = [];
  class FakeAudioContext {
    state = startState;
    currentTime = 0;
    destination = {};
    async resume() {
      this.state = "running";
    }
    createOscillator() {
      const oscillator = {
        type: "",
        frequency: { value: 0 },
        connect: () => {},
        start: () => oscillators.push(oscillator.frequency.value),
        stop: () => {},
      };
      return oscillator;
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
        connect: () => {},
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return oscillators;
}

describe("tones", () => {
  it("play nothing until the browser allows sound, then the notes of each tone", async () => {
    const played = stubAudio("suspended");
    const player = new TonePlayer();

    player.play("success");
    expect(played).toEqual([]);

    expect(await player.unlock()).toBe(true);
    player.play("success");
    player.play("reject");
    expect(played).toEqual([660, 880, 300, 220]);
  });

  it("success rises, reject falls, 'already' is a single note", () => {
    const frequencies = (tone: keyof typeof TONES) => TONES[tone].map((note) => note.frequency);

    expect(frequencies("success")[1]).toBeGreaterThan(frequencies("success")[0] ?? 0);
    expect(frequencies("reject")[1]).toBeLessThan(frequencies("reject")[0] ?? 0);
    expect(frequencies("already")).toHaveLength(1);
  });

  it("are simply off in a browser without Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);

    expect(await new TonePlayer().unlock()).toBe(false);
  });
});

// --- Voice ---------------------------------------------------------------------------------------

type FakeVoice = { lang: string; localService: boolean; name: string };
const voice = (lang: string, localService: boolean, name = lang): FakeVoice => ({
  lang,
  localService,
  name,
});

describe("voice choice", () => {
  it("prefers Indian English on the device, then any Indian English, then English", () => {
    const hindi = voice("hi-IN", true);
    const usLocal = voice("en-US", true);
    const indianOnline = voice("en-IN", false, "online");
    const indianLocal = voice("en-IN", true, "local");

    expect(pickVoice([hindi, usLocal, indianOnline, indianLocal])).toBe(indianLocal);
    expect(pickVoice([hindi, usLocal, indianOnline])).toBe(indianOnline);
    expect(pickVoice([hindi, voice("en-GB", false), usLocal])).toBe(usLocal);
    expect(pickVoice([hindi, voice("mr-IN", true)])).toBeNull();
  });

  function stubSpeech(voices: FakeVoice[]) {
    const spoken: string[] = [];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
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

  it("speaks the line with the chosen voice", () => {
    const spoken = stubSpeech([voice("en-IN", true)]);
    const player = new VoicePlayer();

    player.speak("Checked in.");

    expect(player.canSpeak()).toBe(true);
    expect(spoken).toEqual(["Checked in."]);
  });

  it("stays silent without an English voice (only the tones play)", () => {
    const spoken = stubSpeech([voice("hi-IN", true)]);
    const player = new VoicePlayer();

    player.speak("Checked in.");

    expect(player.canSpeak()).toBe(false);
    expect(spoken).toEqual([]);
  });
});

describe("what each screen plays and says", () => {
  it("never uses the name, and picks the line from the result", () => {
    expect(feedbackFor(result())).toEqual({ tone: "success", voiceKey: "kiosk.voice.in" });
    expect(feedbackFor(result({ direction: "out" }))).toEqual({
      tone: "success",
      voiceKey: "kiosk.voice.out",
    });
    expect(
      feedbackFor(
        result({
          decision: "rejected",
          reason_code: "COOLDOWN_ACTIVE",
          details: { kiosk_name: "Gate", last_direction: "out" },
        }),
      ),
    ).toEqual({ tone: "already", voiceKey: "kiosk.voice.alreadyOut" });
    expect(feedbackFor(result({ decision: "rejected", reason_code: "QR_REVOKED" }))).toEqual({
      tone: "reject",
      voiceKey: "kiosk.punch.QR_REVOKED.voice",
    });
    expect(feedbackFor(result({ decision: "self_test" }))?.voiceKey).toBe("kiosk.voice.selfTest");
  });

  it("uses the general line for an unknown code, a tick for a read card, nothing while scanning", () => {
    expect(
      feedbackFor(result({ decision: "rejected", reason_code: "SOMETHING_NEW" }))?.voiceKey,
    ).toBe("kiosk.punch.INTERNAL_ERROR.voice");
    expect(feedbackFor({ name: "failed", code: "NETWORK_OFFLINE" })).toEqual({
      tone: "reject",
      voiceKey: "kiosk.punch.NETWORK_OFFLINE.voice",
    });
    expect(feedbackFor({ name: "card-read", payload: "UPS1.x" })).toEqual({
      tone: "tick",
      voiceKey: null,
    });
    expect(feedbackFor({ name: "scanning", notACard: false })).toBeNull();
  });
});

// --- Screen-awake lock ---------------------------------------------------------------------------

describe("screen-awake lock", () => {
  it("is requested after the tap and again when the page is visible again", async () => {
    const request = vi.fn(async () => ({ released: false }));
    vi.stubGlobal("navigator", { ...navigator, wakeLock: { request } });
    const keeper = new WakeLockKeeper(() => {});

    expect(await keeper.start()).toBe(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("is tried on load without a tap, stays quiet when refused and retries when visible", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Needs a user gesture"))
      .mockResolvedValue({ released: false });
    vi.stubGlobal("navigator", { ...navigator, wakeLock: { request } });
    const failures: string[] = [];
    const keeper = new WakeLockKeeper((reason) => failures.push(reason));

    expect(await keeper.tryWithoutTap()).toBe(false);
    expect(failures).toEqual([]);

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    // Keepers of earlier tests also listen on the document, so "at least" is the honest check.
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a refusal once and keeps working", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      wakeLock: { request: async () => Promise.reject(new Error("Battery saver is on")) },
    });
    const failures: string[] = [];
    const keeper = new WakeLockKeeper((reason) => failures.push(reason));

    expect(await keeper.start()).toBe(false);
    await keeper.start();

    expect(failures).toEqual(["Battery saver is on"]);
  });
});

// --- Problem reports -----------------------------------------------------------------------------

describe("problem reports", () => {
  it("counts the same problem instead of sending it again", async () => {
    const sent: ReportBody[] = [];
    const reporter = new ErrorReporter(async (body) => sent.push(body), "abc123");

    reporter.report("camera_error", "CAMERA_BLOCKED");
    reporter.report("camera_error", "CAMERA_BLOCKED");
    reporter.report("decoder_fallback", "zxing-wasm");
    await reporter.flush();

    expect(sent).toEqual([
      { kind: "camera_error", message: "CAMERA_BLOCKED", count: 2, app_version: "abc123" },
      { kind: "decoder_fallback", message: "zxing-wasm", count: 1, app_version: "abc123" },
    ]);
    await reporter.flush();
    expect(sent).toHaveLength(2); // nothing new to send
  });

  it("never sends a card text and cuts long messages to 300 characters", () => {
    expect(cleanMessage("Failed on UPS1.A.C000123.ABCDEF2345 at line 4")).toBe(
      "Failed on [card] at line 4",
    );
    expect(cleanMessage("x".repeat(500))).toHaveLength(300);
  });

  it("sends at most 20 reports an hour", async () => {
    let now = 0;
    const sent: ReportBody[] = [];
    const reporter = new ErrorReporter(
      async (body) => sent.push(body),
      "v",
      () => now,
    );

    for (let index = 0; index < 25; index += 1) reporter.report("other", `problem ${index}`);
    await reporter.flush();
    expect(sent).toHaveLength(MAX_REPORTS_PER_HOUR);

    now += 60 * 60 * 1000;
    await reporter.flush();
    expect(sent).toHaveLength(25);
  });

  it("keeps a report when it cannot be sent and tries again next time", async () => {
    let online = false;
    const sent: ReportBody[] = [];
    const reporter = new ErrorReporter(async (body) => {
      if (!online) throw new Error("offline");
      sent.push(body);
    }, "v");

    reporter.report("script_error", "boom");
    await reporter.flush();
    online = true;
    await reporter.flush();

    expect(sent.map((body) => body.message)).toEqual(["boom"]);
  });
});

// --- Self-update ---------------------------------------------------------------------------------

describe("self-update", () => {
  it("sees a newer build, but never updates a development build", async () => {
    expect(await newVersionIsLive("abc123", async () => "def456")).toBe(true);
    expect(await newVersionIsLive("abc123", async () => "abc123")).toBe(false);
    expect(await newVersionIsLive("abc123", async () => null)).toBe(false);
    expect(await newVersionIsLive("abc123", async () => Promise.reject(new Error("offline")))).toBe(
      false,
    );
    expect(await newVersionIsLive("dev", async () => "def456")).toBe(false);
  });

  it("reloads only after 30 s of an idle screen, never during a punch", () => {
    expect(readyToReload(true, 0, IDLE_BEFORE_RELOAD_MS - 1)).toBe(false);
    expect(readyToReload(true, 0, IDLE_BEFORE_RELOAD_MS)).toBe(true);
    expect(readyToReload(true, null, 999_999)).toBe(false); // a punch is in progress
    expect(readyToReload(false, 0, 999_999)).toBe(false); // nothing new to load
  });
});
