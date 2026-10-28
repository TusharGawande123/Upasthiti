// The attendance screen's brain (spec M2 §4.1 to §4.5, M3 §4): starts the camera by itself (zero taps),
// looks for a card about 6 times a second, and after a card is read gives the person time to get
// ready (look at the camera, switch the camera if needed) before the photo is taken. Then it sends
// the punch and shows the answer for a few seconds before scanning again. The face punch
// ("Punch with face") runs in use-face-punch.ts and shares the result handling below.
// The screens only show `screen` and call the actions; all timing lives here.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LocationReport } from "../location/gate-location";
import { INITIAL_SCREEN, isFaceScreen, nextScreen, secondsOnScreen } from "./attendance-machine";
import { LowLightWatcher, measureVideoBrightness } from "./brightness";
import {
  CameraError,
  countCameras,
  type Facing,
  otherFacing,
  playAfterTap,
  startCamera,
  stopCamera,
} from "./camera";
import { loadFacing, saveFacing } from "./camera-preference";
import { type PunchOutcome, sendPunch } from "./punch-client";
import type { KioskScreenSettings } from "./punch-types";
import { createQrDetector, isUpasthitiCard, type QrDetector, SameCardFilter } from "./qr-reader";
import { takeSnapshot } from "./snapshot";
import { useFacePunch } from "./use-face-punch";

const SCAN_EVERY_MS = 150;
const NOT_A_CARD_MS = 3_000;
const BRIGHTNESS_EVERY_MS = 1_000;

export function useAttendance({
  settings,
  onOnline,
  onRevoked,
  onUnpaired,
  onProblem,
  location,
}: {
  settings: KioskScreenSettings;
  onOnline: (online: boolean) => void;
  onRevoked: () => void;
  onUnpaired: () => void;
  /** A problem worth a report to the server log (S-26): camera errors, the slower decoder. */
  onProblem: (kind: "camera_error" | "decoder_fallback", message: string) => void;
  /** M4: card scanning waits while the gate has no usable location; each punch sends it. */
  location: { usable: boolean; report: () => LocationReport | null };
}) {
  const [screen, dispatch] = useReducer(nextScreen, INITIAL_SCREEN);
  const [lowLight, setLowLight] = useState(false);
  // The camera used to read cards and the camera used for the photo are chosen separately.
  const [scanFacing, setScanFacing] = useState<Facing>(() => loadFacing("scan"));
  const [photoFacing, setPhotoFacing] = useState<Facing>(() => loadFacing("photo"));
  const [cameraCount, setCameraCount] = useState(1);
  const [cameraReady, setCameraReady] = useState(false);
  // Time to look at the camera, adjust and switch the camera if needed (a setting, default 20 s).
  const totalSeconds = settings.photo_ready_seconds;
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeFacing = useRef<Facing>(scanFacing);
  const sending = useRef(false);
  const detectorRef = useRef<QrDetector | null>(null);
  const sameCard = useRef(new SameCardFilter());
  // Kept in a ref: a new function from the parent must never restart a punch in progress.
  const handlers = useRef({ onOnline, onRevoked, onUnpaired, onProblem, location });
  handlers.current = { onOnline, onRevoked, onUnpaired, onProblem, location };

  // 1. Start the camera and the QR decoder as soon as the screen opens.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    createQrDetector()
      .then((detector) => {
        detectorRef.current = detector;
        if (detector.usesFallback) {
          handlers.current.onProblem("decoder_fallback", "No built-in QR reader; using zxing-wasm");
        }
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "camera-failed", code: "BROWSER_NOT_SUPPORTED" });
      });
    startCamera(video, activeFacing.current)
      .then((started) => {
        if (cancelled) {
          stopCamera(started);
          return;
        }
        streamRef.current = started;
        setCameraReady(true);
        countCameras().then(setCameraCount);
        dispatch({ type: "camera-ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof CameraError && error.problem === "NEEDS_TAP") {
          streamRef.current = video.srcObject as MediaStream | null;
          dispatch({ type: "camera-needs-tap" });
        } else if (error instanceof CameraError && error.problem !== "NEEDS_TAP") {
          handlers.current.onProblem("camera_error", error.problem);
          dispatch({ type: "camera-failed", code: error.problem });
        } else {
          handlers.current.onProblem("camera_error", String(error));
          dispatch({ type: "camera-failed", code: "CAMERA_NOT_FOUND" });
        }
      });
    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  // 1b. Use the camera the screen needs: the "photo" camera while the person gets ready for the
  // photo, the "scan" camera otherwise. Nothing happens when both are the same camera.
  const cameraStarted =
    screen.name !== "starting" && screen.name !== "needs-tap" && screen.name !== "camera-problem";
  const wantedFacing =
    screen.name === "get-ready" || isFaceScreen(screen) ? photoFacing : scanFacing;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraStarted) return;
    if (streamRef.current && activeFacing.current === wantedFacing) return;
    let cancelled = false;
    setCameraReady(false);
    // Some phones cannot open the second camera while the first is still running.
    stopCamera(streamRef.current);
    streamRef.current = null;
    startCamera(video, wantedFacing)
      .then((started) => {
        if (cancelled) {
          stopCamera(started);
          return;
        }
        streamRef.current = started;
        activeFacing.current = wantedFacing;
        setCameraReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof CameraError ? error.problem : "CAMERA_NOT_FOUND";
        handlers.current.onProblem("camera_error", String(code));
        dispatch({
          type: "camera-failed",
          code: code === "NEEDS_TAP" ? "CAMERA_NOT_FOUND" : code,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cameraStarted, wantedFacing]);

  // 2. While scanning: look for a card about 6 times a second.
  const scanning = screen.name === "scanning" && location.usable;
  const showingNotACard = screen.name === "scanning" && screen.notACard;
  useEffect(() => {
    if (!scanning) return;
    let busy = false;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (busy || !video || !detector || video.readyState < 2) return;
      busy = true;
      try {
        const text = await detector.detect(video);
        if (!text) return;
        if (!isUpasthitiCard(text)) {
          // A UPI or product code: say so for 3 s, never send it.
          if (!showingNotACard) dispatch({ type: "not-a-card" });
          return;
        }
        if (sameCard.current.shouldIgnore(text, Date.now())) return;
        dispatch({ type: "card-read", payload: text });
      } catch {
        // A frame the decoder could not read: try the next one.
      } finally {
        busy = false;
      }
    }, SCAN_EVERY_MS);
    return () => clearInterval(timer);
  }, [scanning, showingNotACard]);

  useEffect(() => {
    if (!showingNotACard) return;
    const timer = setTimeout(() => dispatch({ type: "not-a-card-over" }), NOT_A_CARD_MS);
    return () => clearTimeout(timer);
  }, [showingNotACard]);

  // 3. Card read: the person gets GET_READY_SECONDS to look at the camera. The photo is taken (and
  // the punch sent) when they tap "I am ready" or when the time is over; "Cancel" stops the punch.
  const payload = screen.name === "get-ready" ? screen.payload : null;
  useEffect(() => {
    if (payload === null) return;
    setSecondsLeft(totalSeconds);
    const timer = setInterval(() => setSecondsLeft((left) => left - 1), 1000);
    return () => clearInterval(timer);
  }, [payload, totalSeconds]);

  // The server's answer (or why there is none) of a card punch, a face punch or a typed code.
  const finishPunch = useCallback((outcome: PunchOutcome) => {
    const { onOnline, onRevoked, onUnpaired } = handlers.current;
    if (outcome.kind === "answer") {
      onOnline(true);
      dispatch({ type: "answered", answer: outcome.answer });
      return;
    }
    if (outcome.code === "DEVICE_REVOKED") onRevoked();
    else if (outcome.code === "DEVICE_SIGNATURE_INVALID") onUnpaired();
    onOnline(outcome.code !== "NETWORK_OFFLINE");
    dispatch({ type: "failed", code: outcome.code });
  }, []);

  const takePhotoNow = useCallback(async () => {
    if (payload === null || !cameraReady || sending.current) return;
    sending.current = true;
    try {
      const video = videoRef.current;
      // Without a photo the server answers SNAPSHOT_MISSING, which is the honest result.
      const snapshotBase64 = video ? await takeSnapshot(video).catch(() => "") : "";
      dispatch({ type: "photo-taken" });
      const outcome = await sendPunch(
        { qrPayload: payload, snapshotBase64, location: handlers.current.location.report() },
        { onSlow: () => dispatch({ type: "slow" }) },
      );
      sameCard.current.remember(payload, Date.now());
      finishPunch(outcome);
    } finally {
      sending.current = false;
    }
  }, [payload, cameraReady, finishPunch]);

  const cancelPhoto = useCallback(() => {
    if (payload === null || sending.current) return;
    // The card may still be held up: ignore it for a few seconds so it is not read again at once.
    sameCard.current.remember(payload, Date.now());
    dispatch({ type: "photo-cancelled" });
  }, [payload]);

  // Time over: take the photo if the camera is ready, otherwise cancel (no photo, no punch).
  useEffect(() => {
    if (payload === null || secondsLeft > 0) return;
    if (cameraReady) void takePhotoNow();
    else cancelPhoto();
  }, [payload, secondsLeft, cameraReady, takePhotoNow, cancelPhoto]);

  const switchCamera = useCallback(() => {
    if (screen.name === "get-ready") {
      const next = otherFacing(photoFacing);
      setPhotoFacing(next);
      saveFacing("photo", next);
    } else {
      const next = otherFacing(scanFacing);
      setScanFacing(next);
      saveFacing("scan", next);
    }
  }, [screen.name, photoFacing, scanFacing]);

  // The code pad ran out of time: shown as a rejection, like any other (spec M3 §4.5).
  const expireCode = useCallback(
    () => finishPunch({ kind: "failed", code: "CODE_ENTRY_EXPIRED" }),
    [finishPunch],
  );

  // The face punch: guidance, head turn, pictures, and the code pad when the server is unsure.
  const facePunch = useFacePunch({
    screen,
    dispatch,
    videoRef,
    cameraReady,
    face: settings.face,
    darkThreshold: settings.dark_threshold,
    onOutcome: finishPunch,
    onFailed: (code) => finishPunch({ kind: "failed", code }),
    onCameraProblem: (message) => handlers.current.onProblem("decoder_fallback", message),
    getLocation: () => handlers.current.location.report(),
  });

  // 4. A result or failure stays a few seconds, then the kiosk scans again.
  const holdSeconds = secondsOnScreen(screen, settings);
  useEffect(() => {
    if (holdSeconds === null) return;
    const timer = setTimeout(() => dispatch({ type: "screen-over" }), holdSeconds * 1000);
    return () => clearTimeout(timer);
  }, [holdSeconds]);

  // 5. The low-light hint: measured once a second while the camera is idle.
  const darkThreshold = settings.dark_threshold;
  useEffect(() => {
    if (!scanning) return;
    const watcher = new LowLightWatcher(darkThreshold);
    const canvas = document.createElement("canvas");
    const timer = setInterval(() => {
      const video = videoRef.current;
      const brightness = video ? measureVideoBrightness(video, canvas) : null;
      if (brightness !== null) setLowLight(watcher.update(brightness, Date.now()));
    }, BRIGHTNESS_EVERY_MS);
    return () => clearInterval(timer);
  }, [scanning, darkThreshold]);

  const startCameraAfterTap = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await playAfterTap(video);
      setCameraReady(true);
      countCameras().then(setCameraCount);
      dispatch({ type: "camera-ready" });
    } catch {
      dispatch({ type: "camera-failed", code: "CAMERA_NOT_FOUND" });
    }
  }, []);

  // After allowing the camera in the browser, a fresh start is the reliable way to use it.
  const retryCamera = useCallback(() => window.location.reload(), []);

  return {
    screen,
    videoRef,
    lowLight,
    holdSeconds,
    face: { ...facePunch, expireCode },
    startCameraAfterTap,
    retryCamera,
    // For the "get ready" screen.
    getReady: {
      secondsLeft: Math.max(0, secondsLeft),
      totalSeconds,
      cameraReady,
      takePhotoNow,
      cancelPhoto,
    },
    // The camera button is shown only on a device that has more than one camera.
    camera: {
      canSwitch: cameraCount > 1,
      facing: wantedFacing,
      ready: cameraReady,
      switchCamera,
    },
  };
}
