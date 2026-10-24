// The face punch at the gate, step by step (spec M3 §4.2 to §4.5). One run starts when the person
// taps "Punch with face" (or "Try again"):
//   1. guidance: one face, inside the oval, close enough, held for half a second;
//   2. the server gives a head-turn challenge (its 10 s start only now);
//   3. the device takes the pictures (frontal, turn, frontal) and sends them;
//   4. the answer is a result, or the server asks for the employee code (see `submitCode`).
// The screens only show `screen`, `hint` and call the actions; all timing lives here.
// Pictures stay in memory and are dropped after sending. MediaPipe only decides WHEN to take a
// picture; the server decides every punch.
import { type Dispatch, useCallback, useEffect, useRef, useState } from "react";
import { type FaceGuide, loadFaceGuide } from "@/lib/face-guide/landmarker";
import type { AttendanceEvent, AttendanceScreen } from "./attendance-machine";
import { LowLightWatcher, measureVideoBrightness } from "./brightness";
import { takeFaceFrame } from "./face-capture";
import {
  type CaptureShown,
  CaptureTracker,
  CHALLENGE_STEPS,
  GUIDE_GIVE_UP_MS,
  GUIDE_TIMEOUT_MS,
  type GuideReading,
  GuideTracker,
  readGuide,
} from "./face-sequence";
import {
  type Challenge,
  type FaceFrame,
  type PunchOutcome,
  requestChallenge,
  sendEmployeeCode,
  sendFacePunch,
} from "./punch-client";
import type { KioskFaceSettings } from "./punch-types";

const NOT_READY: GuideReading = { good: false, hint: null };
const GUIDE_EVERY_MS = 150;
const CAPTURE_EVERY_MS = 100;
// The challenge lives `challenge_seconds`; the pictures must be sent a little before that.
const SEND_MARGIN_MS = 1_500;
const GUIDE_LOAD_WAIT_MS = 3_000;
const CHALLENGE_TRIES = 2; // a new challenge once by itself, then "Too slow" (spec §4.3)

/** Waits; resolves false when the run is cancelled meanwhile. */
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

function sameShown(first: CaptureShown, second: CaptureShown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

type Frames = { kind: "frames"; frames: FaceFrame[] } | { kind: "expired" };

export function useFacePunch({
  screen,
  dispatch,
  videoRef,
  cameraReady,
  face,
  darkThreshold,
  onOutcome,
  onFailed,
  onCameraProblem,
}: {
  screen: AttendanceScreen;
  dispatch: Dispatch<AttendanceEvent>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  face: KioskFaceSettings;
  darkThreshold: number;
  /** The server's answer, or why there is none: shown as a result, a failure or the code pad. */
  onOutcome: (outcome: PunchOutcome) => void;
  onFailed: (code: string) => void;
  /** MediaPipe could not load: a report for the server log (the punch still works, timed). */
  onCameraProblem: (message: string) => void;
}) {
  // 0 means no run; each start or retry takes the next number and cancels the run before it.
  const [attempt, setAttempt] = useState(0);
  const [guide, setGuide] = useState<GuideReading>(NOT_READY);
  const guideRef = useRef<FaceGuide | null>(null);
  const guideLoading = useRef<Promise<void> | null>(null);
  const cameraReadyRef = useRef(cameraReady);
  cameraReadyRef.current = cameraReady;
  const latest = useRef({ face, darkThreshold, onOutcome, onFailed, onCameraProblem });
  latest.current = { face, darkThreshold, onOutcome, onFailed, onCameraProblem };

  // MediaPipe loads in the background once the gate shows the button, so the first tap is quick.
  const wantsGuide = face.enabled_for_plant && face.available;
  useEffect(() => {
    if (!wantsGuide || guideLoading.current) return;
    guideLoading.current = loadFaceGuide().then((loaded) => {
      guideRef.current = loaded;
      if (!loaded) latest.current.onCameraProblem("MediaPipe did not load; timed face capture");
    });
  }, [wantsGuide]);
  useEffect(() => () => guideRef.current?.close(), []);

  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    void runFacePunch(controller.signal);
    return () => controller.abort();

    async function runFacePunch(signal: AbortSignal) {
      const camera = videoRef.current;
      if (!camera) return;
      const video: HTMLVideoElement = camera;
      const cameraOk = () => cameraReadyRef.current && video.readyState >= 2;
      // The guide may still be loading on a slow device: give it a moment, then go without.
      if (guideLoading.current && !guideRef.current) {
        await Promise.race([guideLoading.current, sleep(GUIDE_LOAD_WAIT_MS, signal)]);
      }
      const guide = guideRef.current;

      // 1. Guidance until the face has been good for half a second.
      const ready = await guideUntilReady();
      if (!ready || signal.aborted) return;

      // 2 and 3. A challenge, then its pictures; one new challenge by itself if time runs out.
      for (let attemptNumber = 1; attemptNumber <= CHALLENGE_TRIES; attemptNumber++) {
        const given = await requestChallenge();
        if (signal.aborted) return;
        if (given.kind === "failed") return latest.current.onFailed(given.code);
        const taken = await takeFrames(given.challenge);
        if (signal.aborted) return;
        if (taken.kind === "frames") {
          dispatch({ type: "face-sent" });
          const outcome = await sendFacePunch(
            { challengeNonce: given.challenge.challenge_nonce, frames: taken.frames },
            { onSlow: () => dispatch({ type: "slow" }) },
          );
          return latest.current.onOutcome(outcome);
        }
      }
      latest.current.onFailed("CHALLENGE_EXPIRED");

      async function guideUntilReady(): Promise<boolean> {
        const guideTracker = new GuideTracker();
        const watcher = new LowLightWatcher(latest.current.darkThreshold);
        const canvas = document.createElement("canvas");
        const startedAt = performance.now();
        let timedOut = false;
        while (!signal.aborted) {
          const now = performance.now();
          if (cameraOk()) {
            const faces = guide ? guide.read(video, now) : null;
            const brightness = measureVideoBrightness(video, canvas);
            const dark = brightness !== null && watcher.update(brightness, Date.now());
            const reading = readGuide(faces, dark);
            setGuide(reading);
            if (guideTracker.update(now, reading.good).ready) return true;
          }
          if (!timedOut && now - startedAt >= GUIDE_TIMEOUT_MS) {
            timedOut = true;
            setGuide(NOT_READY);
            dispatch({ type: "face-guide-timeout" });
          }
          if (now - startedAt >= GUIDE_GIVE_UP_MS) {
            dispatch({ type: "face-cancel" }); // 30 s without progress: back to the idle screen
            return false;
          }
          // After "Try again" is shown the run waits: a tap starts a new run and ends this one.
          await sleep(GUIDE_EVERY_MS, signal);
        }
        return false;
      }

      async function takeFrames(challenge: Challenge): Promise<Frames> {
        const budgetMs = latest.current.face.challenge_seconds * 1_000 - SEND_MARGIN_MS;
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
        let shown = tracker.shown;
        tracker.start(performance.now());
        dispatch({ type: "face-ready", shown });
        while (!signal.aborted && !tracker.done) {
          const now = performance.now();
          if (now - startedAt > budgetMs) return { kind: "expired" };
          const faces = guide ? guide.read(video, now) : null;
          const action = tracker.update(now, faces);
          if (action.type === "take") {
            await take(action.role);
            if (!sameShown(shown, tracker.shown)) {
              shown = tracker.shown;
              dispatch({ type: "face-step", shown });
            }
          }
          await sleep(CAPTURE_EVERY_MS, signal);
        }
        return { kind: "frames", frames };
      }
    }
  }, [attempt, dispatch, videoRef]);

  const start = useCallback(() => {
    setGuide(NOT_READY);
    setAttempt((current) => current + 1);
    dispatch({ type: "face-start" });
  }, [dispatch]);

  const retry = useCallback(() => {
    setGuide(NOT_READY);
    setAttempt((current) => current + 1);
    dispatch({ type: "face-retry" });
  }, [dispatch]);

  const cancel = useCallback(() => {
    setAttempt(0); // ends the run in progress
    dispatch({ type: "face-cancel" });
  }, [dispatch]);

  /** The employee code typed on the pad (spec §4.5). Each try is one request. */
  const submitCode = useCallback(
    async (code: string) => {
      if (screen.name !== "code-entry") return;
      dispatch({ type: "code-sent" });
      const outcome = await sendEmployeeCode(
        { token: screen.entry.token, code },
        { onSlow: () => dispatch({ type: "slow" }) },
      );
      latest.current.onOutcome(outcome);
    },
    [screen, dispatch],
  );

  return { guide, start, retry, cancel, submitCode };
}
