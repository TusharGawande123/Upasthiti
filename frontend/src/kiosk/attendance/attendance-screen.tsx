// The gate kiosk's main screen after pairing (spec M2 §4.1 to §4.5, design gate B): it opens
// straight to scanning (zero taps). Camera problems replace the scanning area; results cover
// the whole screen for a few seconds. The camera keeps running underneath all of them.
import {
  Camera,
  CameraOff,
  HardDrive,
  LifeBuoy,
  MonitorX,
  RotateCw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Frame } from "../components/frame";
import { ProblemScreen } from "../components/problem-screen";
import { formatIstTime } from "../components/server-clock";
import type { PairedKiosk } from "../device-store";
import { DEFAULT_LOCATION_SETTINGS, useGateLocation } from "../location/gate-location";
import { LocationChip, NeedsLocationScreen } from "../location/needs-location";
import { QUEUE_ALMOST_FULL_SHARE, queueFillShare } from "../offline/offline-queue";
import { useOfflineGate } from "../offline/use-offline";
import { CodePad } from "./code-pad";
import { EarlyOutView } from "./early-out-view";
import { FaceView, showsFaceView } from "./face-view";
import { buildHeartbeat, emptyFacts, type HeartbeatFacts } from "./heartbeat-report";
import { type CodeEntry, canTryAgain, canTryAgainAfterFailure, type KioskMe } from "./punch-types";
import { ResultView } from "./result-view";
import { ScanningView } from "./scanning-view";
import { ConnectionChip, QueueChip, TopClock } from "./top-bar";
import { useAttendance } from "./use-attendance";
import { useHeartbeat } from "./use-heartbeat";
import { useErrorReporter, useSelfUpdate, useSoundAndBanner } from "./use-kiosk-extras";

// The guard's line (F-55, spec §4.2): "All punches sent ✓ 09:02" or "12 punches waiting since 08:05".
function LastSyncLine({
  count,
  oldestSavedWallMs,
  lastSentAtMs,
}: {
  count: number;
  oldestSavedWallMs: number | null;
  lastSentAtMs: number | null;
}) {
  const { t } = useTranslation();
  if (count > 0 && oldestSavedWallMs !== null) {
    const time = formatIstTime(new Date(oldestSavedWallMs), false);
    return (
      <p className="font-bold text-foreground">
        {t("kiosk.offline.lastSync.waiting", {
          count,
          time,
        })}
      </p>
    );
  }
  if (lastSentAtMs === null) return null;
  return (
    <p className="font-bold text-success">
      {t("kiosk.offline.lastSync.allSent", { time: formatIstTime(new Date(lastSentAtMs), false) })}
    </p>
  );
}

function Footer({
  retentionDays,
  offlineSaves,
  sync,
}: {
  retentionDays: number;
  offlineSaves: boolean;
  sync: { count: number; oldestSavedWallMs: number | null; lastSentAtMs: number | null };
}) {
  const { t } = useTranslation();
  // On a phone the long privacy text folds behind a "Privacy" row; larger screens show it all.
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <footer className="space-y-2 border-t bg-card px-4 py-3 text-[24px] text-muted-foreground sm:px-8">
      {offlineSaves ? <LastSyncLine {...sync} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
        <p className="flex items-center gap-3 font-semibold text-foreground sm:order-2">
          <LifeBuoy className="size-7 shrink-0" aria-hidden />
          {t("kiosk.attendance.help")}
        </p>
        <button
          type="button"
          onClick={() => setPrivacyOpen((open) => !open)}
          aria-expanded={privacyOpen}
          className="flex min-h-16 w-full cursor-pointer items-center gap-3 text-left font-semibold sm:hidden"
        >
          <ShieldCheck className="size-7 shrink-0" aria-hidden />
          {t(privacyOpen ? "kiosk.offline.privacyClose" : "kiosk.offline.privacyOpen")}
        </button>
        <p
          className={cn(
            "max-w-full items-start gap-3 sm:order-1 sm:flex sm:max-w-[64%]",
            privacyOpen ? "flex" : "hidden",
          )}
        >
          <ShieldCheck className="mt-0.5 hidden size-7 shrink-0 sm:block" aria-hidden />
          <span>
            {t("kiosk.attendance.privacy", { days: retentionDays })}
            {offlineSaves ? ` ${t("kiosk.offline.privacy")}` : ""}
          </span>
        </p>
      </div>
    </footer>
  );
}

// One tap turns on sound, full screen and the screen-awake lock (browsers need a tap for
// these). Punches work without it; the banner sits in the top bar so nothing moves when it goes.
function SoundBanner({ onTap }: { onTap: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex min-h-16 max-w-[26rem] cursor-pointer items-center gap-3 rounded-2xl bg-primary px-5 py-2 text-left text-[24px] leading-tight font-bold text-primary-foreground shadow-[0_4px_0_0_#162a6e] active:translate-y-[2px] active:shadow-none"
    >
      <Volume2 className="size-8 shrink-0" aria-hidden />
      {t("kiosk.soundBanner")}
    </button>
  );
}

const CAMERA_PROBLEM_ICONS = {
  CAMERA_BLOCKED: CameraOff,
  CAMERA_NOT_FOUND: Camera,
  BROWSER_NOT_SUPPORTED: MonitorX,
};

export function AttendanceScreen({
  kiosk,
  initialMe,
  initialOffsetMs,
  onRevoked,
  onUnpaired,
}: {
  kiosk: PairedKiosk;
  initialMe: KioskMe | null;
  initialOffsetMs: number;
  onRevoked: () => void;
  onUnpaired: () => void;
}) {
  const { t } = useTranslation();
  // What the heartbeat reports is known only after the hooks below exist: it reads this ref.
  const facts = useRef<HeartbeatFacts | null>(null);
  const heartbeat = useHeartbeat(initialMe, initialOffsetMs, {
    onRevoked,
    onUnpaired,
    getReport: () => buildHeartbeat(facts.current ?? emptyFacts()),
  });
  const report = useErrorReporter();
  const locationSettings = heartbeat.settings.location ?? DEFAULT_LOCATION_SETTINGS;
  const place = useGateLocation(locationSettings, heartbeat.online);
  // A punch is on the screen: saved punches wait with their sending until it is over.
  const [punching, setPunching] = useState(false);
  const offline = useOfflineGate({
    settings: heartbeat.settings.offline,
    online: heartbeat.online,
    busy: punching,
    onRevoked,
  });
  const offlineSettings = heartbeat.settings.offline;
  const almostFull =
    offlineSettings?.enabled === true &&
    queueFillShare(offline.queue, offlineSettings) >= QUEUE_ALMOST_FULL_SHARE;
  const attendance = useAttendance({
    settings: heartbeat.settings,
    onOnline: heartbeat.setOnline,
    onRevoked,
    onUnpaired,
    onProblem: report,
    location: place,
    offline,
    serverOffsetMs: heartbeat.serverOffsetMs,
  });
  facts.current = {
    queue: offline.queue,
    place,
    storage: offline.storage,
    offlineReady: offline.ready,
    cameraReady: attendance.camera.ready,
  };
  const idleScreen = attendance.screen.name === "scanning" || attendance.screen.name === "starting";
  useEffect(() => setPunching(!idleScreen), [idleScreen]);
  const sound = useSoundAndBanner(attendance.screen, heartbeat.settings, report);
  useSelfUpdate(attendance.screen);
  const { screen } = attendance;
  const title = `${kiosk.plantName} · ${kiosk.plantCode}`;

  return (
    <Frame
      title={title}
      subtitle={kiosk.kioskName}
      aside={
        <div className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-3 sm:w-auto sm:justify-end">
          {sound.bannerVisible ? <SoundBanner onTap={sound.onBannerTap} /> : null}
          <ConnectionChip online={heartbeat.online} savesOffline={offline.canSave} />
          <QueueChip count={offline.queue.count} sending={heartbeat.online} />
          <LocationChip place={place} />
          <TopClock offsetMs={heartbeat.serverOffsetMs} />
        </div>
      }
      footer={
        <Footer
          retentionDays={heartbeat.settings.snapshot_retention_days}
          offlineSaves={heartbeat.settings.offline?.enabled === true}
          sync={{
            count: offline.queue.count,
            oldestSavedWallMs: offline.queue.oldestSavedWallMs,
            lastSentAtMs: offline.lastSentAtMs,
          }}
        />
      }
    >
      {/* M4 (design gate A 06): the gate still works; the guard should bring the internet back. */}
      {almostFull ? (
        <p
          role="status"
          className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-[24px] font-bold text-foreground sm:text-[30px]"
        >
          <HardDrive className="size-8 shrink-0" aria-hidden />
          {t("kiosk.offline.storageAlmostFull")}
        </p>
      ) : null}
      {/* M4: while the location is not good the camera area is replaced; the camera keeps running. */}
      {place.paused && screen.name === "scanning" ? (
        <NeedsLocationScreen place={place} settings={locationSettings} />
      ) : null}
      <div
        className={
          screen.name === "camera-problem" || (place.paused && screen.name === "scanning")
            ? "hidden"
            : undefined
        }
      >
        <ScanningView
          screen={screen}
          videoRef={attendance.videoRef}
          notices={heartbeat.notices}
          lowLight={attendance.lowLight}
          camera={attendance.camera}
          getReady={attendance.getReady}
          face={{
            ...heartbeat.settings.face,
            // No usable location: the face button hides, like the card scanning pauses.
            enabled_for_plant: heartbeat.settings.face.enabled_for_plant && place.usable,
          }}
          onStartFace={attendance.face.start}
          onStartCamera={attendance.startCameraAfterTap}
        />
      </div>
      {screen.name === "camera-problem" ? (
        <ProblemScreen
          icon={CAMERA_PROBLEM_ICONS[screen.code]}
          serious
          title={t(`kiosk.punch.${screen.code}.title`)}
          message={t(`kiosk.punch.${screen.code}.message`)}
          steps={t(`kiosk.punch.${screen.code}.steps`, { returnObjects: true }) as string[]}
          action={
            screen.code === "BROWSER_NOT_SUPPORTED"
              ? undefined
              : {
                  label: t("kiosk.attendance.tryAgain"),
                  icon: RotateCw,
                  onClick: attendance.retryCamera,
                }
          }
          code={screen.code}
        />
      ) : null}
      {showsFaceView(screen) ? (
        <FaceView
          screen={screen}
          hint={attendance.face.guide.hint}
          good={attendance.face.guide.good}
          videoRef={attendance.videoRef}
          cameraReady={attendance.camera.ready}
          mirrored={attendance.camera.facing === "user"}
          onCancel={attendance.face.cancel}
          onRetry={attendance.face.retry}
        />
      ) : null}
      {screen.name === "code-entry" || (screen.name === "checking" && screen.via === "code") ? (
        <CodePad
          entry={screen.name === "code-entry" ? screen.entry : (screen.entry as CodeEntry)}
          wrong={screen.name === "code-entry" && screen.wrong}
          checking={screen.name === "checking"}
          slow={screen.name === "checking" && screen.slow}
          prefixes={heartbeat.settings.face.code_prefixes}
          totalSeconds={heartbeat.settings.face.code_entry_seconds}
          serverOffsetMs={heartbeat.serverOffsetMs}
          onSubmit={(code) => void attendance.face.submitCode(code)}
          onCancel={attendance.face.cancel}
          onExpired={attendance.face.expireCode}
        />
      ) : null}
      {screen.name === "early-out" ? (
        <EarlyOutView
          prompt={screen.prompt}
          onAgree={() => void attendance.earlyOut.agree()}
          onCancel={attendance.earlyOut.cancel}
        />
      ) : null}
      {screen.name === "result" || screen.name === "failed" ? (
        <ResultView
          answer={screen.name === "result" ? screen.answer : undefined}
          failedCode={screen.name === "failed" ? screen.code : undefined}
          serverOffsetMs={heartbeat.serverOffsetMs}
          title={title}
          subtitle={kiosk.kioskName}
          online={heartbeat.online}
          seconds={attendance.holdSeconds ?? heartbeat.settings.result_seconds}
          viaFace={screen.name === "result" && screen.via !== undefined}
          onTryAgain={
            (screen.name === "result" && canTryAgain(screen.answer)) ||
            (screen.name === "failed" && canTryAgainAfterFailure(screen.code))
              ? attendance.face.retry
              : undefined
          }
        />
      ) : null}
    </Frame>
  );
}
