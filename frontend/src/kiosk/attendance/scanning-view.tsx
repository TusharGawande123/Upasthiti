// The scanning screen (spec §4.2, §4.3, design gate B): the camera on the left with the guide
// frame, and on the right the instruction (or the "get ready for your photo" card, or the checking
// progress), the low-light hint and the gate notices. On a phone the camera is full width above
// the text. The front camera picture is mirrored for the worker; the photo is not.
import {
  Camera,
  CameraOff,
  Check,
  IdCard,
  Loader2,
  type LucideIcon,
  ScanLine,
  SwitchCamera,
  TriangleAlert,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "../components/kiosk-button";
import type { AttendanceScreen } from "./attendance-machine";
import { NoticesPanel } from "./notices-panel";
import type { KioskNotice } from "./punch-types";

type FrameLook = "scan" | "busy" | "not-a-card";

function lookOf(screen: AttendanceScreen): FrameLook {
  if (screen.name === "get-ready" || screen.name === "checking") return "busy";
  if (screen.name === "scanning" && screen.notACard) return "not-a-card";
  return "scan";
}

// Corner brackets with a dark outline, so they show on any picture.
function Brackets({ look }: { look: FrameLook }) {
  const main = look === "busy" ? "#ffffff" : look === "not-a-card" ? "#ffc233" : "var(--signal)";
  const outline = look === "busy" ? "var(--primary)" : "#0e1726";
  const corners = [
    "M2 22 V8 a6 6 0 0 1 6 -6 H22",
    "M78 2 H92 a6 6 0 0 1 6 6 V22",
    "M98 78 V92 a6 6 0 0 1 -6 6 H78",
    "M22 98 H8 a6 6 0 0 1 -6 -6 V78",
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-[11%] size-[78%] overflow-visible"
      aria-hidden
    >
      {corners.map((d) => (
        <g key={d}>
          <path d={d} fill="none" stroke={outline} strokeWidth={3.4} strokeLinecap="round" />
          <path d={d} fill="none" stroke={main} strokeWidth={1.9} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

function FrameStrip({
  icon: Icon,
  text,
  tone,
}: {
  icon: LucideIcon;
  text: string;
  tone: "blue" | "amber";
}) {
  return (
    <p
      className={cn(
        "absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 px-4 py-3 text-center text-[26px] font-bold",
        tone === "blue" ? "bg-primary text-white" : "bg-[var(--flood-already)] text-foreground",
      )}
    >
      <Icon className={cn("size-8 shrink-0", Icon === Loader2 && "animate-spin")} aria-hidden />
      {text}
    </p>
  );
}

function CameraPanel({
  screen,
  videoRef,
  mirrored,
  onStartCamera,
}: {
  screen: AttendanceScreen;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True for the front camera: it shows the worker like a mirror. */
  mirrored: boolean;
  onStartCamera: () => void;
}) {
  const { t } = useTranslation();
  const look = lookOf(screen);
  const live = screen.name !== "needs-tap" && screen.name !== "starting";

  return (
    <div className="relative aspect-square w-full max-w-[520px] shrink-0 overflow-hidden rounded-[20px] border-4 border-foreground bg-[#2b2f38] sm:w-[min(46vw,calc(100vh-262px))] sm:max-w-none sm:min-w-[260px]">
      <video
        ref={videoRef}
        aria-label={t("kiosk.attendance.cameraLabel")}
        className={cn(
          "absolute inset-0 size-full object-cover",
          mirrored && "-scale-x-100",
          !live && "invisible",
        )}
        muted
        playsInline
      />
      {screen.name === "needs-tap" ? (
        <div className="absolute inset-0 grid place-content-center justify-items-center gap-6 p-6">
          <CameraOff className="size-24 text-white" aria-hidden />
          <KioskButton onClick={onStartCamera}>
            <Camera className="size-8" aria-hidden />
            {t("kiosk.attendance.startCamera")}
          </KioskButton>
        </div>
      ) : null}
      {screen.name === "starting" ? (
        <Loader2 className="absolute inset-0 m-auto size-20 animate-spin text-white" aria-hidden />
      ) : null}
      {live ? (
        <>
          <Brackets look={look} />
          {look === "scan" ? (
            <div className="absolute inset-[11%] overflow-hidden" aria-hidden>
              <div className="kiosk-scanline absolute inset-x-0 top-0 h-full -translate-y-1/2 border-b-[7px] border-signal shadow-[0_3px_0_#0e1726]" />
            </div>
          ) : null}
        </>
      ) : null}
      {screen.name === "get-ready" ? (
        <FrameStrip icon={Check} text={t("kiosk.attendance.cardReadShort")} tone="blue" />
      ) : null}
      {screen.name === "checking" ? (
        <FrameStrip icon={Loader2} text={t("kiosk.attendance.checking")} tone="blue" />
      ) : null}
      {look === "not-a-card" ? (
        <FrameStrip icon={TriangleAlert} text={t("kiosk.attendance.notACard")} tone="amber" />
      ) : null}
    </div>
  );
}

function InstructionCard() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-6 rounded-[20px] border-4 border-foreground bg-card p-6 shadow-[0_6px_0_0_#0e1726]">
      <span className="relative grid size-32 shrink-0 place-items-center rounded-2xl border-2 border-[#b9c6ef] bg-primary-soft">
        <IdCard className="size-20 text-foreground" aria-hidden />
        <ScanLine
          className="absolute -top-2 -right-2 size-12 rounded-full bg-signal p-2 text-foreground"
          aria-hidden
        />
      </span>
      <h1 className="text-[44px] leading-tight font-extrabold tracking-tight">
        {t("kiosk.attendance.showCard")}
      </h1>
    </div>
  );
}

function ProgressChip({ done, text }: { done: boolean; text: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-2 px-5 py-2 text-[24px] font-bold",
        done
          ? "border-success bg-success-soft text-success"
          : "border-primary bg-primary-soft text-primary",
      )}
    >
      {done ? (
        <Check className="size-6" aria-hidden />
      ) : (
        <Loader2 className="size-6 animate-spin" aria-hidden />
      )}
      {text}
    </span>
  );
}

function CheckingCard({ screen }: { screen: AttendanceScreen }) {
  const { t } = useTranslation();
  const checking = screen.name === "checking";
  const title =
    checking && screen.slow ? t("kiosk.attendance.serverWaking") : t("kiosk.attendance.checking");
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-5 rounded-[20px] border-4 border-primary bg-card p-8 shadow-[0_6px_0_0_var(--primary)]"
    >
      <span className="grid size-28 place-items-center rounded-full bg-primary text-white">
        {checking ? (
          <Loader2 className="size-16 animate-spin" aria-hidden />
        ) : (
          <Check className="size-16" strokeWidth={3} aria-hidden />
        )}
      </span>
      <h1 className="text-[48px] leading-tight font-extrabold tracking-tight">{title}</h1>
      <div className="flex flex-wrap gap-3">
        <ProgressChip done text={t("kiosk.attendance.chipCardRead")} />
        <ProgressChip done text={t("kiosk.attendance.chipPhotoTaken")} />
        <ProgressChip done={false} text={t("kiosk.attendance.chipChecking")} />
      </div>
    </div>
  );
}

type CameraControls = {
  canSwitch: boolean;
  facing: "user" | "environment";
  ready: boolean;
  switchCamera: () => void;
};

type GetReadyControls = {
  secondsLeft: number;
  totalSeconds: number;
  cameraReady: boolean;
  takePhotoNow: () => void;
  cancelPhoto: () => void;
};

/** Only on a device with more than one camera (a phone, most tablets). */
function SwitchCameraButton({ camera }: { camera: CameraControls }) {
  const { t } = useTranslation();
  if (!camera.canSwitch) return null;
  return (
    <KioskButton variant="key" className="w-full text-[26px]" onClick={camera.switchCamera}>
      <SwitchCamera className="size-8" aria-hidden />
      {camera.facing === "user"
        ? t("kiosk.attendance.useBackCamera")
        : t("kiosk.attendance.useFrontCamera")}
    </KioskButton>
  );
}

/** After the card is read: time to get ready, then the photo (spec: the worker is never rushed). */
function GetReadyCard({
  getReady,
  camera,
}: {
  getReady: GetReadyControls;
  camera: CameraControls;
}) {
  const { t } = useTranslation();
  const share = Math.max(
    0,
    Math.min(100, (getReady.secondsLeft / Math.max(getReady.totalSeconds, 1)) * 100),
  );
  return (
    <div className="space-y-4 rounded-[20px] border-4 border-primary bg-card p-5 shadow-[0_6px_0_0_var(--primary)] sm:p-8">
      <h1
        aria-live="polite"
        className="text-[36px] leading-tight font-extrabold tracking-tight sm:text-[44px]"
      >
        {t("kiosk.attendance.getReadyTitle")}
      </h1>
      <p className="text-[24px] leading-snug">{t("kiosk.attendance.getReadyText")}</p>
      <div>
        <p className="tnum text-[32px] font-extrabold text-primary">
          {t("kiosk.attendance.photoIn", { count: getReady.secondsLeft })}
        </p>
        <div className="mt-2 h-4 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
      </div>
      <div className="grid gap-3">
        <KioskButton
          className="w-full"
          disabled={!getReady.cameraReady}
          onClick={getReady.takePhotoNow}
        >
          <Camera className="size-8" aria-hidden />
          {t("kiosk.attendance.imReady")}
        </KioskButton>
        <SwitchCameraButton camera={camera} />
        <KioskButton variant="key" className="w-full text-[26px]" onClick={getReady.cancelPhoto}>
          <X className="size-7" aria-hidden />
          {t("kiosk.attendance.cancelPhoto")}
        </KioskButton>
      </div>
    </div>
  );
}

export function ScanningView({
  screen,
  videoRef,
  notices,
  lowLight,
  camera,
  getReady,
  onStartCamera,
}: {
  screen: AttendanceScreen;
  videoRef: RefObject<HTMLVideoElement | null>;
  notices: KioskNotice[];
  lowLight: boolean;
  camera: CameraControls;
  getReady: GetReadyControls;
  onStartCamera: () => void;
}) {
  const { t } = useTranslation();
  const checking = screen.name === "checking";
  const gettingReady = screen.name === "get-ready";
  const busy = checking || gettingReady;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
      <CameraPanel
        screen={screen}
        videoRef={videoRef}
        mirrored={camera.facing === "user"}
        onStartCamera={onStartCamera}
      />
      <div className="w-full min-w-0 flex-1 space-y-4">
        {gettingReady ? (
          <GetReadyCard getReady={getReady} camera={camera} />
        ) : checking ? (
          <CheckingCard screen={screen} />
        ) : (
          <>
            <InstructionCard />
            <SwitchCameraButton camera={camera} />
          </>
        )}
        {lowLight && !busy ? (
          <p
            role="status"
            className="flex items-center gap-3 rounded-2xl border-2 border-warning bg-warning-soft px-5 py-3 text-[26px] font-bold text-warning"
          >
            <TriangleAlert className="size-8 shrink-0" aria-hidden />
            {t("kiosk.attendance.lowLight")}
          </p>
        ) : null}
        {busy ? null : <NoticesPanel notices={notices} />}
      </div>
    </div>
  );
}
