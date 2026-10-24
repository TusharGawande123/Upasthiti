// The full-screen result after a punch (spec §4.4, §4.5, design gate B): a colour flood with a big
// icon AND a big word (never colour alone), the server time, and a countdown back to scanning.
// The name is shown only for IN, OUT and "already"; never on a rejection, and never spoken.

import type { TFunction } from "i18next";
import {
  CircleAlert,
  Clock3,
  Hourglass,
  IdCard,
  Info,
  LogIn,
  LogOut,
  type LucideIcon,
  MoveRight,
  RotateCw,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "../components/kiosk-button";
import { formatIstTime } from "../components/server-clock";
import { rejectionTextCode } from "./feedback";
import { type PunchAnswer, type ResultKind, resultKind } from "./punch-types";

type Look = "in" | "out" | "already" | "reject";
type Shape = "circle" | "square" | "octagon";

const FLOOD: Record<Look, { background: string; band: string; ink: boolean }> = {
  in: { background: "bg-[var(--flood-in)]", band: "bg-[var(--flood-in-dark)]", ink: false },
  out: { background: "bg-[var(--flood-out)]", band: "bg-[var(--flood-out-dark)]", ink: false },
  already: {
    background: "bg-[var(--flood-already)]",
    band: "bg-[var(--flood-already-dark)]",
    ink: true,
  },
  reject: {
    background: "bg-[var(--flood-reject)]",
    band: "bg-[var(--flood-reject-dark)]",
    ink: false,
  },
};

// Codes that have their own texts in the translation file; anything else shows the general error.
const KNOWN_CODES = new Set([
  "QR_REVOKED",
  "QR_EXPIRED",
  "QR_NOT_YET_VALID",
  "WRONG_PLANT",
  "EMPLOYEE_NOT_QR",
  "EMPLOYEE_INACTIVE",
  "QR_SIGNATURE_INVALID",
  "QR_FORMAT_INVALID",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_INVALID",
  "QR_SIGNING_NOT_CONFIGURED",
  "NETWORK_OFFLINE",
  "SERVER_NO_ANSWER",
  "INTERNAL_ERROR",
  "TOO_MANY_REQUESTS",
  "PAYLOAD_TOO_LARGE",
  // Face punch (spec M3 §9).
  "NO_FACE",
  "MULTIPLE_FACES",
  "FACE_TOO_SMALL",
  "FACE_QUALITY_LOW",
  "LIVENESS_FAILED",
  "FACE_INCONSISTENT",
  "CHALLENGE_EXPIRED",
  "SPOOF_SUSPECTED",
  "CHALLENGE_INVALID",
  "FRAMES_INVALID",
  "FACE_NOT_RECOGNISED",
  "CODE_ENTRY_EXPIRED",
  "WRONG_PLANT_FACE",
  "FACE_SERVICE_UNAVAILABLE",
  "FACE_SERVICE_BUSY",
  "FACE_NOT_CONFIGURED",
]);

// Nobody did anything wrong: the punch was not saved, please wait (amber, not red; decision 0019).
const WAIT_CODES = new Set(["FACE_SERVICE_UNAVAILABLE", "FACE_SERVICE_BUSY", "TOO_MANY_REQUESTS"]);

/** The "stopped" or "please wait" look of a rejection or a failure. */
function stoppedLook(code: string, texts: string, time: string, t: TFunction): Shown {
  const waiting = WAIT_CODES.has(code);
  return {
    look: waiting ? "already" : "reject",
    icon: waiting ? Hourglass : code === "NETWORK_OFFLINE" ? WifiOff : X,
    shape: waiting ? "square" : "octagon",
    word: t(`kiosk.punch.${texts}.title`),
    lead: t(`kiosk.punch.${texts}.message`),
    card: { icon: MoveRight, main: t(`kiosk.punch.${texts}.next`) },
    adminCode: code,
    time,
  };
}

function textCode(code: string): string {
  return KNOWN_CODES.has(code) ? code : "INTERNAL_ERROR";
}

function hhmm(iso: string | null | undefined, withSeconds = false): string {
  return iso ? formatIstTime(new Date(iso), withSeconds) : "";
}

function Countdown({ seconds, ink }: { seconds: number; ink: boolean }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const timer = setInterval(() => setLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return (
    <div className="space-y-2 px-4 pb-6 sm:px-14">
      <p
        className={cn(
          "flex items-center gap-3 text-[24px] font-bold",
          ink ? "text-foreground" : "text-white",
        )}
      >
        <Clock3 className="size-7" aria-hidden />
        {t("kiosk.result.backIn", { count: left })}
      </p>
      <div
        className={cn(
          "h-5 overflow-hidden rounded-full",
          ink ? "bg-white ring-2 ring-foreground" : "bg-black/25",
        )}
        aria-hidden
      >
        <div
          className={cn("h-full rounded-full", ink ? "bg-foreground" : "bg-white")}
          style={{ width: `${(left / Math.max(seconds, 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function BigIcon({ icon: Icon, shape, look }: { icon: LucideIcon; shape: Shape; look: Look }) {
  const colour = {
    in: "text-[var(--flood-in)]",
    out: "text-[var(--flood-out)]",
    already: "text-warning",
    reject: "text-[var(--flood-reject)]",
  }[look];
  return (
    <span
      className={cn(
        "grid size-[132px] place-items-center bg-white sm:size-[200px]",
        shape === "circle" && "rounded-full ring-4 ring-black/25 sm:ring-8",
        shape === "square" &&
          "rounded-[28px] border-[6px] border-foreground sm:rounded-[36px] sm:border-8",
        colour,
      )}
      style={
        shape === "octagon"
          ? {
              clipPath:
                "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)",
            }
          : undefined
      }
    >
      <Icon className="size-[72px] sm:size-[100px]" strokeWidth={2.5} aria-hidden />
    </span>
  );
}

type Shown = {
  look: Look;
  icon: LucideIcon;
  shape: Shape;
  word: string;
  lead?: string;
  name?: string;
  card?: { icon: LucideIcon; main: string; sub?: string };
  adminCode?: string;
  time: string;
};

function describeAnswer(answer: PunchAnswer, t: TFunction, viaFace: boolean): Shown {
  const kind: ResultKind = resultKind(answer);
  const time = hhmm(answer.server_time);
  const name = answer.employee?.display_name;
  const code = answer.employee?.employee_code ?? "";
  if (kind === "in" || kind === "out") {
    const isIn = kind === "in";
    return {
      look: kind,
      icon: isIn ? LogIn : LogOut,
      shape: "circle",
      word: t(isIn ? "kiosk.result.in" : "kiosk.result.out"),
      lead: t(isIn ? "kiosk.result.welcome" : "kiosk.result.goodbye"),
      name,
      card: {
        icon: IdCard,
        main: t("kiosk.result.codeChecked", {
          code,
          status: t(isIn ? "kiosk.result.checkedIn" : "kiosk.result.checkedOut"),
        }),
      },
      time,
    };
  }
  if (kind === "already") {
    const lastOut = answer.details.last_direction === "out";
    const lastTime = hhmm(answer.details.last_punch_at);
    const main =
      answer.reason_code === "OUT_TOO_SOON"
        ? t("kiosk.result.outAfter", {
            time: lastTime,
            outTime: hhmm(answer.details.out_allowed_from),
          })
        : t(lastOut ? "kiosk.result.alreadyOutAt" : "kiosk.result.alreadyInAt", { time: lastTime });
    return {
      look: "already",
      icon: Info,
      shape: "square",
      word: t(lastOut ? "kiosk.result.alreadyOut" : "kiosk.result.alreadyIn"),
      name,
      card: { icon: Info, main, sub: t("kiosk.result.codeLine", { code }) },
      time,
    };
  }
  if (kind === "self-test") {
    return {
      look: "in",
      icon: Wrench,
      shape: "circle",
      word: t("kiosk.result.kioskOk"),
      lead: t("kiosk.result.noAttendance"),
      card: {
        icon: Wrench,
        main: t("kiosk.result.selfTestChecks", { time: hhmm(answer.server_time, true) }),
        sub: answer.details.kiosk_name,
      },
      time,
    };
  }
  const reason = answer.reason_code ?? "INTERNAL_ERROR";
  return stoppedLook(reason, textCode(rejectionTextCode(reason, viaFace)), time, t);
}

function describeFailure(code: string, time: string, t: TFunction): Shown {
  const shown = stoppedLook(code, textCode(code), time, t);
  // A failure that is not a server rejection (no answer, an error) keeps its own icon.
  return shown.icon === X ? { ...shown, icon: CircleAlert } : shown;
}

export function ResultView({
  answer,
  failedCode,
  serverOffsetMs,
  title,
  subtitle,
  online,
  seconds,
  viaFace = false,
  onTryAgain,
}: {
  answer?: PunchAnswer;
  failedCode?: string;
  /** For failures, which have no server time of their own: the server clock when shown. */
  serverOffsetMs: number;
  title: string;
  subtitle: string;
  online: boolean;
  seconds: number;
  /** The punch was a face punch (or the code typed after one): face wording. */
  viaFace?: boolean;
  /** Given when another try can help: shows the "Try again" button. */
  onTryAgain?: () => void;
}) {
  const { t } = useTranslation();
  const [shownAt] = useState(() => new Date(Date.now() + serverOffsetMs).toISOString());
  const shown = answer
    ? describeAnswer(answer, t, viaFace)
    : describeFailure(failedCode ?? "INTERNAL_ERROR", hhmm(shownAt), t);
  const flood = FLOOD[shown.look];
  const textColour = flood.ink ? "text-foreground" : "text-white";
  const isRejection =
    shown.look === "reject" || (shown.adminCode !== undefined && shown.look === "already");

  return (
    <div
      className={cn(
        "kiosk-theme fixed inset-0 z-20 flex flex-col overflow-y-auto",
        flood.background,
      )}
      role={isRejection ? "alert" : "status"}
      aria-live={isRejection ? "assertive" : "polite"}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8",
          flood.band,
        )}
      >
        <div className="text-white">
          <p className="text-[30px] leading-tight font-extrabold">{title}</p>
          <p className="text-[24px]">{subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[24px] font-bold text-foreground">
          {online ? (
            <Wifi className="size-6" aria-hidden />
          ) : (
            <WifiOff className="size-6" aria-hidden />
          )}
          {t(online ? "kiosk.attendance.online" : "kiosk.attendance.offline")}
        </span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4 sm:gap-8 sm:px-14 sm:py-6 lg:flex-row lg:items-center">
        <div className="flex shrink-0 flex-col items-center gap-4 sm:gap-6">
          <BigIcon icon={shown.icon} shape={shown.shape} look={shown.look} />
          <div className="rounded-2xl border-4 border-black/30 bg-white px-4 py-2 text-center sm:px-6 sm:py-3">
            <p className="text-[24px] font-semibold text-muted-foreground">
              {t("kiosk.result.serverTime")}
            </p>
            <p className="tnum text-[40px] leading-none font-extrabold text-foreground sm:text-[88px]">
              {shown.time}
            </p>
          </div>
        </div>
        <div className={cn("min-w-0 flex-1 space-y-2 sm:space-y-4", textColour)}>
          <p className="text-[56px] leading-[0.95] font-black tracking-tight break-words sm:text-[96px] lg:text-[120px]">
            {shown.word}
          </p>
          {shown.lead ? (
            <p className="text-[28px] leading-tight font-bold sm:text-[40px]">{shown.lead}</p>
          ) : null}
          {shown.name ? (
            <p
              className={cn(
                "leading-tight font-extrabold break-words",
                shown.name.length > 28
                  ? "text-[32px] sm:text-[48px] lg:text-[64px]"
                  : "text-[44px] sm:text-[72px] lg:text-[96px]",
              )}
            >
              {shown.name}
            </p>
          ) : null}
          {shown.card ? (
            <div className="flex items-start gap-3 rounded-2xl border-4 border-black/25 bg-white px-4 py-3 text-foreground sm:gap-4 sm:px-6 sm:py-4">
              <shown.card.icon className="mt-1 size-9 shrink-0" aria-hidden />
              <div>
                <p className="text-[26px] leading-snug font-bold sm:text-[32px]">
                  {shown.card.main}
                </p>
                {shown.card.sub ? (
                  <p className="text-[24px] text-muted-foreground">{shown.card.sub}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {onTryAgain ? (
            <KioskButton
              variant="key"
              className="min-h-24 w-full border-4 border-foreground text-[36px]"
              onClick={onTryAgain}
            >
              <RotateCw className="size-10" aria-hidden />
              {t("kiosk.attendance.tryAgain")}
            </KioskButton>
          ) : null}
          {shown.adminCode ? (
            <p className="text-[24px] font-bold">
              {t("kiosk.result.forAdmin")}{" "}
              <span className="code rounded-md bg-white px-2 py-0.5 text-foreground">
                {shown.adminCode}
              </span>
            </p>
          ) : null}
        </div>
      </main>
      <Countdown seconds={seconds} ink={flood.ink} />
    </div>
  );
}
