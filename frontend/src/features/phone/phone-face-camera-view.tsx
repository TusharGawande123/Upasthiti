// The camera picture of a phone face check (design gate P2, screen 4): a 3:4 frame with an oval,
// and a strip below that always has an icon AND words. The preview is mirrored like a mirror;
// the pictures sent to the server are not (see kiosk/attendance/face-capture.ts).
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Focus,
  Loader2,
  type LucideIcon,
  ScanFace,
  Sun,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FaceRunScreen } from "./phone-use-face-run";

const HINTS: Record<string, { icon: LucideIcon; text: string }> = {
  closer: { icon: ZoomIn, text: "kiosk.face.hintCloser" },
  farther: { icon: ZoomOut, text: "kiosk.face.hintFarther" },
  one_person: { icon: Users, text: "kiosk.face.hintOnePerson" },
  centre: { icon: Focus, text: "kiosk.face.hintCentre" },
  light: { icon: Sun, text: "kiosk.face.hintLight" },
};

export function FaceCameraView({
  screen,
  videoRef,
}: {
  screen: FaceRunScreen;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const { t } = useTranslation();
  let icon: LucideIcon = ScanFace;
  let line = t("kiosk.face.guideTitle");
  let tone: "waiting" | "good" | "busy" = "waiting";
  if (screen.name === "guide") {
    if (screen.good) {
      icon = Check;
      line = t("kiosk.face.good");
      tone = "good";
    } else if (screen.hint) {
      const hint = HINTS[screen.hint];
      if (hint) {
        icon = hint.icon;
        line = t(hint.text);
      }
    } else if (screen.timedOut) {
      line = t("kiosk.face.guideTimeout");
    }
  } else if (screen.name === "turn") {
    if (screen.shown.phase === "turn") {
      const left = screen.shown.direction === "left";
      icon = left ? ArrowLeft : ArrowRight;
      line = `${t(left ? "kiosk.face.turnLeft" : "kiosk.face.turnRight")} ${t(left ? "kiosk.face.left" : "kiosk.face.right")}`;
    } else {
      icon = Check;
      line = t("kiosk.face.straightAgain");
    }
  } else if (screen.name === "checking") {
    icon = Loader2;
    line = t("phone.checking");
    tone = "busy";
  }
  const Icon = icon;

  return (
    <div className="overflow-hidden rounded-xl border-2 bg-[#0e1726]">
      <div className="relative mx-auto aspect-[3/4] max-h-[70dvh] w-full overflow-hidden [container-type:size]">
        <video
          ref={videoRef}
          aria-label={t("kiosk.face.cameraLabel")}
          className="absolute inset-0 size-full -scale-x-100 object-cover"
          muted
          playsInline
        />
        <span
          aria-hidden
          className={cn(
            "absolute top-[46%] left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[6px] shadow-[0_0_0_100vmax_rgba(14,23,38,0.62)]",
            tone === "waiting" && "border-dashed border-white",
            tone === "good" && "border-solid border-[#3ddc84]",
            tone === "busy" && "border-solid border-white",
          )}
          style={{ height: "min(84cqh, 118cqw)", aspectRatio: "3 / 4" }}
        />
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center justify-center gap-3 px-4 py-4 text-center text-xl font-bold",
          tone === "good" ? "bg-[#035a40] text-white" : "bg-signal text-foreground",
        )}
      >
        <Icon className={cn("size-7 shrink-0", Icon === Loader2 && "animate-spin")} aria-hidden />
        {line}
      </p>
    </div>
  );
}
