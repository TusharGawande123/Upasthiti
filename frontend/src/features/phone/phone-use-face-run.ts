// One face check on the phone, used by two pages (the "prove it is you" step and the face punch).
// It is the gate's face punch (M3) in one function: guidance until one face is held inside the
// oval, then the server's head-turn challenge, then the pictures. The page decides what to ask
// the server (`requestChallenge`) and what to do with the pictures (`send`). MediaPipe only
// decides WHEN a picture is taken; the server decides everything else. Pictures stay in memory.
import { useCallback, useEffect, useRef, useState } from "react";
import { takeFaceFrame } from "@/kiosk/attendance/face-capture";
import {
  type CaptureShown,
  CaptureTracker,
  CHALLENGE_STEPS,
  GUIDE_GIVE_UP_MS,
  GUIDE_TIMEOUT_MS,
  type GuideHint,
  GuideTracker,
  readGuide,
} from "@/kiosk/attendance/face-sequence";
import { type FaceGuide, loadFaceGuide } from "@/lib/face-guide/landmarker";
import type { FaceFrame, PhoneChallenge } from "./phone-api";

export type FaceRunScreen =
  | { name: "idle" }
  | { name: "guide"; good: boolean; hint: GuideHint | null; timedOut: boolean }
  | { name: "turn"; shown: CaptureShown }
  | { name: "checking" };

const GUIDE_EVERY_MS = 150;
const CAPTURE_EVERY_MS = 100;
const SEND_MARGIN_MS = 1_500;
const GUIDE_LOAD_WAIT_MS = 3_000;
const CHALLENGE_TRIES = 2;

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      { once: true },
    );
  });
}

type RunOptions<Result> = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  /** Asks the server for a head-turn challenge (may throw an ApiError). */
  requestChallenge: () => Promise<PhoneChallenge>;
  /** Sends the pictures (may throw an ApiError). */
  send: (challenge: PhoneChallenge, frames: FaceFrame[]) => Promise<Result>;
  onDone: (result: Result) => void;
  onFail: (error: unknown) => void;
};

export function useFaceRun<Result>(options: RunOptions<Result>) {
  const [screen, setScreen] = useState<FaceRunScreen>({ name: "idle" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(options);
  latest.current = options;
  const guideRef = useRef<FaceGuide | null>(null);
  const guideLoading = useRef<Promise<void> | null>(null);

  // MediaPipe loads in the background as soon as the page is open, so the first start is quick.
  useEffect(() => {
    if (guideLoading.current) return;
    guideLoading.current = loadFaceGuide().then((loaded) => {
      guideRef.current = loaded;
    });
  }, []);
  useEffect(() => () => guideRef.current?.close(), []);

  useEffect(() => {
    if (attempt === 0 || !options.cameraReady) return;
    const controller = new AbortController();
    void run(controller.signal);
    return () => controller.abort();

    async function run(signal: AbortSignal) {
      const video = latest.current.videoRef.current;
      if (!video) return;
      if (guideLoading.current && !guideRef.current) {
        await Promise.race([guideLoading.current, sleep(GUIDE_LOAD_WAIT_MS, signal)]);
      }
      const guide = guideRef.current;
      try {
        if (!(await guideUntilReady(video, guide, signal))) return;
        for (let tryNumber = 1; tryNumber <= CHALLENGE_TRIES; tryNumber++) {
          const challenge = await latest.current.requestChallenge();
          if (signal.aborted) return;
          const frames = await takeFrames(video, guide, challenge, signal);
          if (signal.aborted) return;
          if (frames) {
            setScreen({ name: "checking" });
            const result = await latest.current.send(challenge, frames);
            if (!signal.aborted) latest.current.onDone(result);
            return;
          }
        }
        latest.current.onFail(new Error("CHALLENGE_EXPIRED"));
      } catch (error) {
        if (!signal.aborted) latest.current.onFail(error);
      }
    }

    async function guideUntilReady(
      video: HTMLVideoElement,
      guide: FaceGuide | null,
      signal: AbortSignal,
    ): Promise<boolean> {
      const tracker = new GuideTracker();
      const startedAt = performance.now();
      while (!signal.aborted) {
        const now = performance.now();
        if (video.readyState >= 2) {
          const reading = readGuide(guide ? guide.read(video, now) : null, false);
          setScreen({
            name: "guide",
            good: reading.good,
            hint: reading.hint,
            timedOut: now - startedAt >= GUIDE_TIMEOUT_MS,
          });
          if (tracker.update(now, reading.good).ready) return true;
        }
        if (now - startedAt >= GUIDE_GIVE_UP_MS) {
          latest.current.onFail(new Error("NO_FACE"));
          return false;
        }
        await sleep(GUIDE_EVERY_MS, signal);
      }
      return false;
    }

    async function takeFrames(
      video: HTMLVideoElement,
      guide: FaceGuide | null,
      challenge: PhoneChallenge,
      signal: AbortSignal,
    ): Promise<FaceFrame[] | null> {
      const budgetMs = challengeBudget(challenge);
      const startedAt = performance.now();
      const tracker = new CaptureTracker(
        CHALLENGE_STEPS[challenge.challenge],
        challenge.capture.min_yaw_degrees,
        guide !== null,
      );
      const frames: FaceFrame[] = [];
      const take = async (role: FaceFrame["role"]) => {
        frames.push({ role, jpeg: await takeFaceFrame(video) });
      };
      await take("frontal");
      tracker.start(performance.now());
      setScreen({ name: "turn", shown: tracker.shown });
      while (!signal.aborted && !tracker.done) {
        const now = performance.now();
        if (now - startedAt > budgetMs) return null;
        const action = tracker.update(now, guide ? guide.read(video, now) : null);
        if (action.type === "take") {
          await take(action.role);
          setScreen({ name: "turn", shown: tracker.shown });
        }
        await sleep(CAPTURE_EVERY_MS, signal);
      }
      return tracker.done ? frames : null;
    }
  }, [attempt, options.cameraReady]);

  const start = useCallback(() => {
    setScreen({ name: "guide", good: false, hint: null, timedOut: false });
    setAttempt((current) => current + 1);
  }, []);
  const cancel = useCallback(() => {
    setAttempt(0);
    setScreen({ name: "idle" });
  }, []);

  return { screen, start, cancel };
}

/** The challenge lives `expires_at - server_time`; pictures must be sent a little before that. */
function challengeBudget(challenge: PhoneChallenge): number {
  const lifeMs =
    new Date(challenge.expires_at).getTime() - new Date(challenge.server_time).getTime();
  return (Number.isFinite(lifeMs) && lifeMs > 0 ? lifeMs : 10_000) - SEND_MARGIN_MS;
}
