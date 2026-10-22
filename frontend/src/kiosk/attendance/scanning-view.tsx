// The scanning screen (spec §4.2, §4.3, design gate B): the camera on the left with the guide
// frame, and on the right the instruction (or the checking progress), the low-light hint and
// the gate notices. The camera picture is mirrored for the worker; the photo is not.
import {
  Camera,
  CameraOff,
  Check,
  IdCard,
  Loader2,
  type LucideIcon,
  ScanLine,
  TriangleAlert,
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
  if (screen.name === "card-read" || screen.name === "checking") return "busy";
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
  onStartCamera,
}: {
  screen: AttendanceScreen;
  videoRef: RefObject<HTMLVideoElement | null>;
  onStartCamera: () => void;
}) {
  const { t } = useTranslation();
  const look = lookOf(screen);
  const live = screen.name !== "needs-tap" && screen.name !== "starting";

  return (
    <div className="relative aspect-square w-[min(46vw,calc(100vh-262px))] min-w-[260px] shrink-0 overflow-hidden rounded-[20px] border-4 border-foreground bg-[#2b2f38]">
      <video
        ref={videoRef}
        aria-label={t("kiosk.attendance.cameraLabel")}
        className={cn("absolute inset-0 size-full -scale-x-100 object-cover", !live && "invisible")}
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
      {screen.name === "card-read" ? (
        <FrameStrip icon={Check} text={t("kiosk.attendance.cardRead")} tone="blue" />
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
  const title = !checking
    ? t("kiosk.attendance.cardRead")
    : screen.slow
      ? t("kiosk.attendance.serverWaking")
      : t("kiosk.attendance.checking");
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
        <ProgressChip done={checking} text={t("kiosk.attendance.chipLookAtCamera")} />
        {checking ? <ProgressChip done={false} text={t("kiosk.attendance.chipChecking")} /> : null}
      </div>
    </div>
  );
}

export function ScanningView({
  screen,
  videoRef,
  notices,
  lowLight,
  onStartCamera,
}: {
  screen: AttendanceScreen;
  videoRef: RefObject<HTMLVideoElement | null>;
  notices: KioskNotice[];
  lowLight: boolean;
  onStartCamera: () => void;
}) {
  const { t } = useTranslation();
  const busy = screen.name === "card-read" || screen.name === "checking";
  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
      <CameraPanel screen={screen} videoRef={videoRef} onStartCamera={onStartCamera} />
      <div className="min-w-0 flex-1 space-y-4">
        {busy ? <CheckingCard screen={screen} /> : <InstructionCard />}
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
