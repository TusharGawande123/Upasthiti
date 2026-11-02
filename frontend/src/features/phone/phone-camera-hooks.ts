// Camera and location helpers of the phone pages. They reuse the gate's tested code
// (kiosk/attendance/camera.ts and kiosk/location.ts); the phone only decides what to show.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraError,
  type Facing,
  playAfterTap,
  startCamera,
  stopCamera,
} from "@/kiosk/attendance/camera";
import { LocationError, measureLocation } from "@/kiosk/location";
import type { PhoneLocation } from "./phone-api";

export type CameraStatus = "opening" | "ready" | "blocked" | "not_found" | "needs_tap";

/** Opens the camera of the given side while `active`, and always switches it off afterwards. */
export function useCamera(facing: Facing, active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>("opening");
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the camera
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setStatus("opening");
    startCamera(video, facing)
      .then((opened) => {
        stream = opened;
        if (cancelled) return stopCamera(opened);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const problem = error instanceof CameraError ? error.problem : "CAMERA_NOT_FOUND";
        setStatus(
          problem === "NEEDS_TAP"
            ? "needs_tap"
            : problem === "CAMERA_BLOCKED"
              ? "blocked"
              : "not_found",
        );
      });
    return () => {
      cancelled = true;
      stopCamera(stream);
      const attached = video.srcObject as MediaStream | null;
      stopCamera(attached);
      video.srcObject = null;
    };
  }, [active, facing, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const tapToPlay = useCallback(async () => {
    const video = videoRef.current;
    if (video) await playAfterTap(video);
    setStatus("ready");
  }, []);
  return { videoRef, status, retry, tapToPlay };
}

export type LocationProblem = "PHONE_LOCATION_DENIED" | "LOCATION_REQUIRED";

/**
 * One fresh reading right now (the phone never tracks in the background, spec M4b §4.8). Throws
 * the code that the screen shows: a refused permission, or no reading at all.
 */
export async function readPhoneLocation(maxWaitMs = 15_000): Promise<PhoneLocation> {
  try {
    const reading = await measureLocation({ maxWaitMs });
    return { ...reading, age_s: 0 };
  } catch (error) {
    const denied = error instanceof LocationError && error.reason === "denied";
    throw new PhoneLocationError(denied ? "PHONE_LOCATION_DENIED" : "LOCATION_REQUIRED");
  }
}

export class PhoneLocationError extends Error {
  readonly code: LocationProblem;
  constructor(code: LocationProblem) {
    super(code);
    this.name = "PhoneLocationError";
    this.code = code;
  }
}

/**
 * Reads QR codes from the camera picture a few times a second. `onText` gets the text of every
 * new code (the same text is not repeated while it stays in view). The decoder is loaded only
 * here, so only the pages that scan ever download it.
 */
export function useQrScan(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  onText: (text: string) => void,
) {
  const latest = useRef(onText);
  latest.current = onText;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let lastText: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const { createQrDetector } = await import("@/kiosk/attendance/qr-reader");
      const detector = await createQrDetector();
      const tick = async () => {
        const video = videoRef.current;
        if (stopped) return;
        if (video && video.readyState >= 2) {
          try {
            const text = await detector.detect(video);
            if (text && text !== lastText) {
              lastText = text;
              latest.current(text);
            }
            if (!text) lastText = null;
          } catch {
            // A single bad frame is ignored; the next one is tried.
          }
        }
        timer = setTimeout(tick, 250);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, videoRef]);
}
