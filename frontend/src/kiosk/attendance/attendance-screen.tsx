// The gate kiosk's main screen after pairing (spec M2 §4.1 to §4.5, design gate B): it opens
// straight to scanning (zero taps). Camera problems replace the scanning area; results cover
// the whole screen for a few seconds. The camera keeps running underneath all of them.
import { Camera, CameraOff, LifeBuoy, MonitorX, RotateCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Frame } from "../components/frame";
import { ProblemScreen } from "../components/problem-screen";
import type { PairedKiosk } from "../device-store";
import type { KioskMe } from "./punch-types";
import { ResultView } from "./result-view";
import { ScanningView } from "./scanning-view";
import { ConnectionChip, TopClock } from "./top-bar";
import { useAttendance } from "./use-attendance";
import { useHeartbeat } from "./use-heartbeat";

function Footer({ retentionDays }: { retentionDays: number }) {
  const { t } = useTranslation();
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t bg-card px-8 py-3 text-[24px] text-muted-foreground">
      <p className="flex max-w-[64%] items-start gap-3">
        <ShieldCheck className="mt-0.5 size-7 shrink-0" aria-hidden />
        {t("kiosk.attendance.privacy", { days: retentionDays })}
      </p>
      <p className="flex items-center gap-3 font-semibold text-foreground">
        <LifeBuoy className="size-7 shrink-0" aria-hidden />
        {t("kiosk.attendance.help")}
      </p>
    </footer>
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
  const heartbeat = useHeartbeat(initialMe, initialOffsetMs, { onRevoked, onUnpaired });
  const attendance = useAttendance({
    settings: heartbeat.settings,
    onOnline: heartbeat.setOnline,
    onRevoked,
    onUnpaired,
  });
  const { screen } = attendance;
  const title = `${kiosk.plantName} · ${kiosk.plantCode}`;

  return (
    <Frame
      title={title}
      subtitle={kiosk.kioskName}
      aside={
        <div className="flex items-center gap-5">
          <ConnectionChip online={heartbeat.online} />
          <TopClock offsetMs={heartbeat.serverOffsetMs} />
        </div>
      }
      footer={<Footer retentionDays={heartbeat.settings.snapshot_retention_days} />}
    >
      <div className={screen.name === "camera-problem" ? "hidden" : undefined}>
        <ScanningView
          screen={screen}
          videoRef={attendance.videoRef}
          notices={heartbeat.notices}
          lowLight={attendance.lowLight}
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
      {screen.name === "result" || screen.name === "failed" ? (
        <ResultView
          answer={screen.name === "result" ? screen.answer : undefined}
          failedCode={screen.name === "failed" ? screen.code : undefined}
          serverOffsetMs={heartbeat.serverOffsetMs}
          title={title}
          subtitle={kiosk.kioskName}
          online={heartbeat.online}
          seconds={attendance.holdSeconds ?? heartbeat.settings.result_seconds}
        />
      ) : null}
    </Frame>
  );
}
