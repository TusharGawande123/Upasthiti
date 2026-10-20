// The attendance screen's brain (spec M2 §4.1 to §4.5): starts the camera by itself (zero taps),
// looks for a card about 6 times a second, takes the photo 0.7 s after a card is read, sends the
// punch and shows the answer for a few seconds before scanning again.
// The screens only show `screen` and call the actions; all timing lives here.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INITIAL_SCREEN, nextScreen, secondsOnScreen } from "./attendance-machine";
import { LowLightWatcher, measureVideoBrightness } from "./brightness";
import { CameraError, playAfterTap, startCamera, stopCamera } from "./camera";
import { sendPunch } from "./punch-client";
import type { KioskScreenSettings } from "./punch-types";
import { createQrDetector, isUpasthitiCard, type QrDetector, SameCardFilter } from "./qr-reader";
import { takeSnapshot } from "./snapshot";

const SCAN_EVERY_MS = 150;
const LOOK_AT_CAMERA_MS = 700;
const NOT_A_CARD_MS = 3_000;
const BRIGHTNESS_EVERY_MS = 1_000;

export function useAttendance({
  settings,
  onOnline,
  onRevoked,
  onUnpaired,
}: {
  settings: KioskScreenSettings;
  onOnline: (online: boolean) => void;
  onRevoked: () => void;
  onUnpaired: () => void;
}) {
  const [screen, dispatch] = useReducer(nextScreen, INITIAL_SCREEN);
  const [lowLight, setLowLight] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<QrDetector | null>(null);
  const sameCard = useRef(new SameCardFilter());
  // Kept in a ref: a new function from the parent must never restart a punch in progress.
  const handlers = useRef({ onOnline, onRevoked, onUnpaired });
  handlers.current = { onOnline, onRevoked, onUnpaired };

  // 1. Start the camera and the QR decoder as soon as the screen opens.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    createQrDetector()
      .then((detector) => {
        detectorRef.current = detector;
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "camera-failed", code: "BROWSER_NOT_SUPPORTED" });
      });
    startCamera(video)
      .then((started) => {
        stream = started;
        if (cancelled) stopCamera(started);
        else dispatch({ type: "camera-ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof CameraError && error.problem === "NEEDS_TAP") {
          stream = video.srcObject as MediaStream | null;
          dispatch({ type: "camera-needs-tap" });
        } else if (error instanceof CameraError && error.problem !== "NEEDS_TAP") {
          dispatch({ type: "camera-failed", code: error.problem });
        } else {
          dispatch({ type: "camera-failed", code: "CAMERA_NOT_FOUND" });
        }
      });
    return () => {
      cancelled = true;
      stopCamera(stream);
    };
  }, []);

  // 2. While scanning: look for a card about 6 times a second.
  const scanning = screen.name === "scanning";
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

  // 3. Card read: give the person 0.7 s to look at the camera, take the photo, send the punch.
  const payload = screen.name === "card-read" ? screen.payload : null;
  useEffect(() => {
    if (payload === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const video = videoRef.current;
      // Without a photo the server answers SNAPSHOT_MISSING, which is the honest result.
      const snapshotBase64 = video ? await takeSnapshot(video).catch(() => "") : "";
      if (cancelled) return;
      dispatch({ type: "photo-taken" });
      const outcome = await sendPunch(
        { qrPayload: payload, snapshotBase64 },
        { onSlow: () => dispatch({ type: "slow" }) },
      );
      sameCard.current.remember(payload, Date.now());
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
    }, LOOK_AT_CAMERA_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payload]);

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
      dispatch({ type: "camera-ready" });
    } catch {
      dispatch({ type: "camera-failed", code: "CAMERA_NOT_FOUND" });
    }
  }, []);

  // After allowing the camera in the browser, a fresh start is the reliable way to use it.
  const retryCamera = useCallback(() => window.location.reload(), []);

  return { screen, videoRef, lowLight, holdSeconds, startCameraAfterTap, retryCamera };
}
