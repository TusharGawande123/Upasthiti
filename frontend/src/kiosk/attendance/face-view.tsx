// The face punch screens (spec M3 §4.2 to §4.4, design gate A, mockups 02 to 04): the camera
// fills the screen with an oval for the face, a short line says what to do, and Cancel is always
// there until the pictures are sent. The picture is mirrored like a mirror; the pictures sent to
// the server are not (see face-capture.ts).
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Focus,
  Loader2,
  type LucideIcon,
  RotateCw,
  ScanFace,
  Sun,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "../components/kiosk-button";
import type { AttendanceScreen } from "./attendance-machine";
import type { GuideHint } from "./face-sequence";

export type FaceScreen = Extract<
  AttendanceScreen,
  { name: "face-guide" } | { name: "face-challenge" } | { name: "checking" }
>;

/** The three screens this view draws: guidance, head turn, and checking after a face punch. */
export function showsFaceView(screen: AttendanceScreen): screen is FaceScreen {
  return (
    screen.name === "face-guide" ||
    screen.name === "face-challenge" ||
    (screen.name === "checking" && screen.via === "face")
  );
}

const HINT_LOOK: Record<GuideHint, { icon: LucideIcon; text: string }> = {
  closer: { icon: ZoomIn, text: "kiosk.face.hintCloser" },
  farther: { icon: ZoomOut, text: "kiosk.face.hintFarther" },
  one_person: { icon: Users, text: "kiosk.face.hintOnePerson" },
  centre: { icon: Focus, text: "kiosk.face.hintCentre" },
  light: { icon: Sun, text: "kiosk.face.hintLight" },
};

// A second picture of the camera stream: the first <video> (the one the code reads from) stays
// under this screen, so the guidance and the pictures use the same stream.
function LivePicture({
  source,
  cameraReady,
  mirrored,
}: {
  source: RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  mirrored: boolean;
}) {
  const { t } = useTranslation();
  const picture = useRef<HTMLVideoElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a restarted camera is a new stream
  useEffect(() => {
    const video = picture.current;
    const stream = source.current?.srcObject;
    if (!video || !stream) return;
    video.srcObject = stream;
    if (typeof video.play === "function") void Promise.resolve(video.play()).catch(() => undefined);
  }, [source, cameraReady]);
  return (
    <video
      ref={picture}
      aria-label={t("kiosk.face.cameraLabel")}
      className={cn("absolute inset-0 size-full object-cover", mirrored && "-scale-x-100")}
      muted
      playsInline
    />
  );
}

type OvalLook = "waiting" | "good" | "busy";

// The oval is a 3:4 shape sized from the camera area (container units, so it is never squashed on
// a narrow phone). The huge shadow dims everything around it; the area clips it.
function Oval({ look }: { look: OvalLook }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[46%] left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[6px] shadow-[0_0_0_100vmax_rgba(14,23,38,0.62)] outline-[3px] outline-[#0e1726]",
        look === "waiting" && "border-dashed border-white motion-safe:animate-pulse",
        look === "good" && "border-solid border-[#3ddc84]",
        look === "busy" && "border-solid border-white outline-[#1f3a93]",
      )}
      style={{ height: "min(84cqh, 118cqw)", aspectRatio: "3 / 4" }}
    />
  );
}

function HeaderBar({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: "signal" | "success" | "blue";
  children: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-4 bg-[#0e1726] px-4 py-3 text-white sm:px-8">
      <span
        className={cn(
          "grid size-16 shrink-0 place-items-center rounded-full border-4 border-white",
          tone === "signal" && "bg-signal text-foreground",
          tone === "success" && "bg-[#3ddc84] text-foreground",
          tone === "blue" && "bg-white text-primary",
        )}
      >
        <Icon className={cn("size-9", Icon === Loader2 && "animate-spin")} aria-hidden />
      </span>
      <div
        role="status"
        aria-live="polite"
        className="min-w-0 flex-1 text-[30px] leading-tight font-extrabold sm:text-[40px]"
      >
        {children}
      </div>
    </header>
  );
}

function Strip({
  icon: Icon,
  text,
  tone,
}: {
  icon: LucideIcon;
  text: string;
  tone: "amber" | "green";
}) {
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-3 px-4 py-3 text-center text-[28px] font-bold",
        tone === "amber"
          ? "bg-[var(--flood-already)] text-foreground"
          : "bg-[var(--flood-in)] text-white",
      )}
    >
      <Icon className="size-8 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

export function FaceView({
  screen,
  hint,
  good,
  videoRef,
  cameraReady,
  mirrored,
  onCancel,
  onRetry,
}: {
  screen: FaceScreen;
  hint: GuideHint | null;
  good: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  mirrored: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const checking = screen.name === "checking";
  const challenge = screen.name === "face-challenge" ? screen.shown : null;
  const turning = challenge?.phase === "turn" ? challenge : null;
  const timedOut = screen.name === "face-guide" && screen.timedOut;
  // Green once the face is good (and through the head turn).
  const look: OvalLook = checking ? "busy" : challenge || good ? "good" : "waiting";

  return (
    <div className="kiosk-theme fixed inset-0 z-20 flex flex-col bg-[#0e1726]">
      <div
        aria-hidden
        className="h-3 shrink-0 bg-[repeating-linear-gradient(135deg,var(--signal)_0_18px,#0f172a_18px_36px)]"
      />
      {checking ? (
        <HeaderBar icon={Loader2} tone="blue">
          {screen.slow ? t("kiosk.attendance.serverWaking") : t("kiosk.attendance.checking")}
        </HeaderBar>
      ) : turning ? (
        <HeaderBar icon={ArrowLeftRight} tone="signal">
          <span className="flex flex-wrap items-center gap-x-3">
            {t(turning.direction === "left" ? "kiosk.face.turnLeft" : "kiosk.face.turnRight")}
            <span className="rounded-xl bg-signal px-3 text-foreground">
              {t(turning.direction === "left" ? "kiosk.face.left" : "kiosk.face.right")}
            </span>
          </span>
        </HeaderBar>
      ) : challenge ? (
        <HeaderBar icon={Check} tone="success">
          {t("kiosk.face.straightAgain")}
        </HeaderBar>
      ) : (
        <HeaderBar icon={ScanFace} tone="signal">
          {t("kiosk.face.guideTitle")}
        </HeaderBar>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ containerType: "size" }}>
        <LivePicture source={videoRef} cameraReady={cameraReady} mirrored={mirrored} />
        <Oval look={look} />
        {turning ? (
          // The arrow points the way the person turns; the picture is mirrored like a mirror.
          <span
            aria-hidden
            className={cn(
              "absolute top-[44%] grid size-24 -translate-y-1/2 place-items-center rounded-full border-4 border-white bg-primary text-white shadow-lg",
              turning.direction === "left" ? "left-[4%]" : "right-[4%]",
              "motion-safe:animate-pulse",
            )}
          >
            {turning.direction === "left" ? (
              <ArrowLeft className="size-14" strokeWidth={3} />
            ) : (
              <ArrowRight className="size-14" strokeWidth={3} />
            )}
          </span>
        ) : null}
        {checking ? (
          <span
            aria-hidden
            className="absolute top-[46%] left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-primary bg-white text-primary"
          >
            <Loader2 className="size-14 animate-spin" />
          </span>
        ) : null}
      </div>

      {timedOut ? (
        <Strip icon={ScanFace} text={t("kiosk.face.guideTimeout")} tone="amber" />
      ) : screen.name === "face-guide" && hint && !good ? (
        <Strip icon={HINT_LOOK[hint].icon} text={t(HINT_LOOK[hint].text)} tone="amber" />
      ) : screen.name === "face-guide" && good ? (
        <Strip icon={Check} text={t("kiosk.face.good")} tone="green" />
      ) : null}

      {checking ? null : (
        <div className={cn("grid gap-3 bg-card p-3", timedOut && "sm:grid-cols-2")}>
          {timedOut ? (
            <KioskButton className="w-full" onClick={onRetry}>
              <RotateCw className="size-8" aria-hidden />
              {t("kiosk.attendance.tryAgain")}
            </KioskButton>
          ) : null}
          <KioskButton
            variant="key"
            className="w-full border-4 border-foreground"
            onClick={onCancel}
          >
            <X className="size-8" aria-hidden />
            {t("kiosk.face.cancel")}
          </KioskButton>
        </div>
      )}
    </div>
  );
}
