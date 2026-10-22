// The kiosk's helpers around the attendance screen: tones and the spoken line for each result,
// the one-tap banner (sound, full screen, screen awake), problem reports to the server and the
// self-update when a new build is live. None of them is needed for a punch to work.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { signedRequest } from "../signer";
import type { AttendanceScreen } from "./attendance-machine";
import { ErrorReporter, type ReportKind, SEND_EVERY_MS } from "./error-reporter";
import { feedbackFor, VOICE_DELAY_MS } from "./feedback";
import type { KioskScreenSettings } from "./punch-types";
import { CHECK_EVERY_MS, newVersionIsLive, readyToReload } from "./self-update";
import { TonePlayer } from "./sound";
import { VoicePlayer } from "./voice";
import { WakeLockKeeper } from "./wake-lock";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
const IDLE_CHECK_EVERY_MS = 5_000;

/** Problem reports (S-26). Also catches script errors anywhere on the kiosk page. */
export function useErrorReporter() {
  const reporter = useRef<ErrorReporter | null>(null);
  reporter.current ??= new ErrorReporter(
    (body) => signedRequest("POST", "/kiosk/report", body),
    APP_VERSION,
  );

  useEffect(() => {
    const onError = (event: ErrorEvent) => reporter.current?.report("script_error", event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      reporter.current?.report("script_error", String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const timer = setInterval(() => void reporter.current?.flush(), SEND_EVERY_MS);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearInterval(timer);
    };
  }, []);

  return useCallback((kind: ReportKind, message: string) => {
    reporter.current?.report(kind, message);
  }, []);
}

/** Tones, voice and the one-tap banner (F-1, S-29). */
export function useSoundAndBanner(
  screen: AttendanceScreen,
  settings: KioskScreenSettings,
  report: (kind: ReportKind, message: string) => void,
) {
  const { t } = useTranslation();
  const tones = useRef<TonePlayer | null>(null);
  const voice = useRef<VoicePlayer | null>(null);
  const wakeLock = useRef<WakeLockKeeper | null>(null);
  tones.current ??= new TonePlayer();
  voice.current ??= new VoicePlayer();
  wakeLock.current ??= new WakeLockKeeper((reason) => report("wake_lock_failed", reason));
  const [bannerVisible, setBannerVisible] = useState(true);

  // Kiosk-mode browsers may allow sound without a tap (setup guide): try once at the start.
  // The screen wake lock is tried too: after a self-update reload nobody has tapped, and the
  // browser may still allow it. Full screen and sound need the tap (the banner stays).
  useEffect(() => {
    void tones.current?.unlock();
    void wakeLock.current?.tryWithoutTap();
  }, []);

  const onBannerTap = useCallback(async () => {
    setBannerVisible(false);
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
    await tones.current?.unlock();
    await wakeLock.current?.start();
  }, []);

  const { sound_enabled: soundOn, voice_enabled: voiceOn } = settings;
  useEffect(() => {
    const feedback = feedbackFor(screen);
    // The server already turns both off when this gate's sound is switched off.
    if (!feedback || !soundOn || !tones.current?.isReady()) return;
    tones.current.play(feedback.tone);
    const { voiceKey } = feedback;
    if (!voiceOn || !voiceKey) return;
    const timer = setTimeout(() => voice.current?.speak(t(voiceKey)), VOICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [screen, soundOn, voiceOn, t]);

  return { bannerVisible, onBannerTap };
}

/** Reload into a new build, but only after 30 s of an idle scanning screen (S-27). */
export function useSelfUpdate(screen: AttendanceScreen) {
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const idleSince = useRef<number | null>(null);
  const idle = screen.name === "scanning" && !screen.notACard;

  useEffect(() => {
    idleSince.current = idle ? Date.now() : null;
  }, [idle]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (await newVersionIsLive(APP_VERSION)) setUpdateWaiting(true);
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!updateWaiting) return;
    const timer = setInterval(() => {
      if (readyToReload(true, idleSince.current, Date.now())) window.location.reload();
    }, IDLE_CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [updateWaiting]);
}
