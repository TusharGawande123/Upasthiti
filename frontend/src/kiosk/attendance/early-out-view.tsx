// The alert before an OUT that is earlier than the shift end (M5, decision 0036 line 9; approved
// mockups: docs/design-refs/m5/gate-early-out/). Two looks, one layout:
//   "before_half": the half shift is not complete yet (amber), the time to the half and to the end;
//   "before_end": the half is done, the full shift is not over (blue), the time to the end.
// Agree sends the OUT; Cancel, Escape, or 20 seconds of silence send nothing. No name is shown.

import { Check, Clock3, Flag, Hourglass, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "../components/kiosk-button";
import { formatIstTime } from "../components/server-clock";
import type { EarlyOutPrompt } from "./punch-types";

export const EARLY_OUT_SECONDS = 20;

type Props = {
  prompt: EarlyOutPrompt;
  onAgree: () => void;
  onCancel: () => void;
  seconds?: number;
};

/** 110 -> { hours: 1, minutes: 50 }; the text hides the hours when there are none. */
export function splitDuration(totalMinutes: number) {
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function Duration({ minutes, className }: { minutes: number; className?: string }) {
  const { t } = useTranslation();
  const { hours, minutes: rest } = splitDuration(minutes);
  return (
    <span className={cn("tnum text-[40px] leading-none font-extrabold", className)}>
      {hours > 0
        ? t("gate.earlyOut.duration", { hours, minutes: rest })
        : t("gate.earlyOut.durationMinutes", { minutes: rest })}
    </span>
  );
}

function TimeRow({
  icon,
  label,
  time,
  minutes,
  main,
  warning,
}: {
  icon: React.ReactNode;
  label: string;
  time: string;
  minutes: number;
  main: boolean;
  warning: boolean;
}) {
  const { t } = useTranslation();
  const tone = !main
    ? "border-[#0e1726] bg-[#f4f6f9]"
    : warning
      ? "border-[#b97300] bg-[#fff3d6]"
      : "border-[#8da0e0] bg-[#eaeefb]";
  const ink = main ? (warning ? "text-[#7a4500]" : "text-[#1a3282]") : "text-[#0e1726]";
  return (
    <div
      className={cn("flex items-center gap-4 rounded-2xl border-2 px-5 py-4", tone, "flex-wrap")}
    >
      <span aria-hidden className={cn("shrink-0", ink)}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[24px] leading-tight font-bold text-[#4a5567]">
        {label}
        <br />
        <span className="font-semibold">{t("gate.earlyOut.atTime", { time })}</span>
      </span>
      <Duration minutes={minutes} className={ink} />
    </div>
  );
}

export function EarlyOutView({ prompt, onAgree, onCancel, seconds = EARLY_OUT_SECONDS }: Props) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);
  const warning = prompt.tier === "before_half";

  // One tick a second; at zero the alert closes like Cancel and nothing is recorded.
  useEffect(() => {
    const timer = setInterval(() => setLeft((current) => current - 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) onCancel();
  }, [left, onCancel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const shown = Math.max(left, 0);
  const endTime = formatIstTime(new Date(prompt.shift_end), false);
  const halfTime = prompt.half_at ? formatIstTime(new Date(prompt.half_at), false) : "";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(14,23,38,0.72)] p-0 md:items-center md:p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="early-out-title"
        aria-describedby="early-out-sentence"
        className="w-full max-w-[900px] overflow-hidden rounded-t-3xl border-4 border-[#0e1726] bg-white shadow-[0_8px_0_0_#0e1726] md:rounded-3xl"
      >
        <div
          className={cn(
            "flex items-center gap-4 border-b-4 border-[#0e1726] px-5 py-4",
            warning ? "bg-[#fff3d6] text-[#7a4500]" : "bg-[#eaeefb] text-[#1a3282]",
          )}
        >
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center rounded-full border-4 border-current"
          >
            {warning ? <TriangleAlert className="size-9" /> : <Clock3 className="size-9" />}
          </span>
          <div className="min-w-0">
            <p className="hidden text-[24px] font-bold md:block">{t("gate.earlyOut.tag")}</p>
            <h2
              id="early-out-title"
              className="text-[28px] leading-tight font-extrabold text-[#0e1726] md:text-[36px]"
            >
              {t(warning ? "gate.earlyOut.half.title" : "gate.earlyOut.full.title")}
            </h2>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {warning && prompt.half_remaining_min !== null ? (
            <TimeRow
              icon={<Hourglass className="size-8" />}
              label={t("gate.earlyOut.halfRemaining")}
              time={halfTime}
              minutes={prompt.half_remaining_min}
              main
              warning
            />
          ) : null}
          <TimeRow
            icon={<Flag className="size-8" />}
            label={t("gate.earlyOut.fullRemaining")}
            time={endTime}
            minutes={prompt.full_remaining_min}
            main={!warning}
            warning={false}
          />

          <p id="early-out-sentence" className="text-[26px] leading-snug font-bold text-[#0e1726]">
            {t(warning ? "gate.earlyOut.half.consequence" : "gate.earlyOut.full.consequence")}
          </p>

          <div className="flex items-center gap-4" aria-hidden>
            <div className="h-5 flex-1 overflow-hidden rounded-full border-2 border-[#0e1726] bg-[#e3e8f0]">
              <div
                className="h-full bg-[#1f3a93] transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                style={{ width: `${(shown / seconds) * 100}%` }}
              />
            </div>
            <span className="tnum text-[24px] font-semibold whitespace-nowrap text-[#4a5567]">
              {t("gate.earlyOut.cancelsIn", { seconds: shown })}
            </span>
          </div>
          <p className="sr-only" aria-live="polite">
            {shown === 10 || shown === 5 ? t("gate.earlyOut.cancelsIn", { seconds: shown }) : ""}
          </p>

          <div className="flex flex-col gap-4 md:flex-row">
            {/* biome-ignore lint/a11y/noAutofocus: Agree is the default focus of the alert. */}
            <KioskButton
              autoFocus
              onClick={onAgree}
              className="min-h-[72px] flex-1 border-4 border-[#0e1726] bg-[#1f3a93] text-[32px] text-white shadow-[0_4px_0_0_#142a6b] hover:bg-[#1f3a93] md:min-h-[92px]"
            >
              <Check aria-hidden className="size-9" />
              {t("gate.earlyOut.agree")}
            </KioskButton>
            <KioskButton
              variant="key"
              onClick={onCancel}
              className="min-h-[72px] flex-1 border-4 border-[#0e1726] text-[32px] md:min-h-[92px]"
            >
              <X aria-hidden className="size-9" />
              {t("gate.earlyOut.cancel")}
            </KioskButton>
          </div>
        </div>
      </div>
    </div>
  );
}
