// The question before a phone OUT that is earlier than the shift end (decision 0036 lines 77 and
// 88): "You are leaving before the shift ends. Leave now?" with Agree and Cancel. The words and the
// two looks (amber: the half shift is not complete; blue: the half is done, the full shift is
// not over) are the ones of the gate's alert (kiosk/attendance/early-out-view.tsx), in the phone's
// one-column cards. The server did the sums; the phone only shows them. Cancel sends nothing.
// Agree reads the location again and sends the token; the server decides the punch again.
import { Check, Clock3, Flag, Hourglass, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PHONE_APP_VERSION,
  type PhoneEarlyOutPrompt,
  type PhonePunchAnswer,
  phoneApi,
} from "./phone-api";
import { readPhoneLocation } from "./phone-camera-hooks";
import { PhoneButton, PhoneCard } from "./phone-ui";

/** 110 -> "1 h 50 min"; 45 -> "45 min". */
function Duration({ minutes, className }: { minutes: number; className?: string }) {
  const { t } = useTranslation();
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return (
    <span className={cn("text-[32px] leading-none font-extrabold tabular-nums", className)}>
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
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  time: string;
  minutes: number;
  tone: "amber" | "blue" | "plain";
}) {
  const { t } = useTranslation();
  const look = {
    amber: "border-warning/50 bg-warning-soft text-warning",
    blue: "border-primary/40 bg-primary-soft text-primary-soft-foreground",
    plain: "border-border bg-muted text-foreground",
  }[tone];
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border-2 p-4", look)}>
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-lg leading-tight font-bold">
        {label}
        <br />
        <span className="font-semibold">{t("gate.earlyOut.atTime", { time })}</span>
      </span>
      <Duration minutes={minutes} />
    </div>
  );
}

export function PhoneEarlyOutStep({
  prompt,
  photo,
  onAnswer,
  onFail,
  onCancel,
}: {
  prompt: PhoneEarlyOutPrompt;
  /** A gate-code punch sends its selfie again (the server never stored it). */
  photo?: string;
  onAnswer: (answer: PhonePunchAnswer) => void;
  onFail: (error: unknown) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const warning = prompt.tier === "before_half";

  const agree = async () => {
    setBusy(true);
    try {
      const location = await readPhoneLocation();
      onAnswer(
        await phoneApi.earlyOutConfirm({
          client_punch_id: prompt.client_punch_id,
          token: prompt.token,
          photo_jpeg: photo ?? null,
          location,
          app_version: PHONE_APP_VERSION,
        }),
      );
    } catch (error) {
      onFail(error);
    }
  };

  return (
    <PhoneCard
      role="alertdialog"
      aria-labelledby="phone-early-out-title"
      aria-describedby="phone-early-out-sentence"
      className="space-y-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-16 shrink-0 place-items-center rounded-full border-4",
            warning ? "border-warning text-warning" : "border-primary text-primary",
          )}
        >
          {warning ? <TriangleAlert className="size-8" /> : <Clock3 className="size-8" />}
        </span>
        <div className="min-w-0">
          <p className="text-lg font-bold text-muted-foreground">{t("gate.earlyOut.tag")}</p>
          <h2 id="phone-early-out-title" className="text-[26px] leading-tight font-extrabold">
            {t("phone.earlyOut.question")}
          </h2>
        </div>
      </div>

      <p className="text-xl font-bold">
        {t(warning ? "gate.earlyOut.half.title" : "gate.earlyOut.full.title")}
      </p>
      {warning && prompt.half_remaining_min !== null && prompt.half_at ? (
        <TimeRow
          icon={<Hourglass className="size-7" />}
          label={t("gate.earlyOut.halfRemaining")}
          time={formatTime(prompt.half_at)}
          minutes={prompt.half_remaining_min}
          tone="amber"
        />
      ) : null}
      <TimeRow
        icon={<Flag className="size-7" />}
        label={t("gate.earlyOut.fullRemaining")}
        time={formatTime(prompt.shift_end)}
        minutes={prompt.full_remaining_min}
        tone={warning ? "plain" : "blue"}
      />
      <p id="phone-early-out-sentence" className="text-xl leading-snug font-bold">
        {t(warning ? "gate.earlyOut.half.consequence" : "gate.earlyOut.full.consequence")}
      </p>

      <div className="space-y-3 pt-1">
        <PhoneButton busy={busy} onClick={() => void agree()}>
          {busy ? null : <Check aria-hidden />}
          {busy ? t("phone.checking") : t("gate.earlyOut.agree")}
        </PhoneButton>
        {busy ? null : (
          <PhoneButton variant="outline" onClick={onCancel}>
            <X aria-hidden />
            {t("gate.earlyOut.cancel")}
          </PhoneButton>
        )}
      </div>
    </PhoneCard>
  );
}
