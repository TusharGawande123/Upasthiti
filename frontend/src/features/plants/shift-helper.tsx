// The live helper box of the shift form: a little timeline and five plain-word lines that say what
// the typed times mean ("On time until 09:30 ..."). It reads only the typed values, so it updates
// as the person types. Rules follow decision 0036 line 8: grace only at the start, none at the end.
import { Clock, CornerUpRight, Hourglass, LogOut, Moon, Sparkles, Split } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/features/attendance/attendance-format";
import { fromMinutes, toMinutes } from "./shift-summary";

export type HelperValues = {
  start: string; // "09:00"
  end: string; // "17:00"
  fullDayMin: number; // the shift length
  graceMin: number;
  halfDayMin: number;
  overtimeMin: number;
};

function Line({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

// Three bars side by side, as wide as their minutes: grace, the rest of the shift, overtime window.
function Timeline({
  values,
  onTime,
  overtimeFrom,
}: {
  values: HelperValues;
  onTime: string;
  overtimeFrom: string;
}) {
  const { t } = useTranslation();
  const total = values.fullDayMin + values.overtimeMin;
  const percent = (minutes: number) => `${(minutes / total) * 100}%`;
  const grace = Math.min(values.graceMin, values.fullDayMin);
  const overtimeEnd = fromMinutes(toMinutes(values.end) + values.overtimeMin);
  const label = t("shiftForm.timeline.alt", {
    start: values.start,
    end: values.end,
    onTime,
    overtime: overtimeFrom,
  });
  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className="flex h-3.5 w-full gap-px overflow-hidden rounded-full"
      >
        {grace > 0 ? (
          <span
            className="rounded-l-full border border-primary bg-card"
            style={{ width: percent(grace) }}
          />
        ) : null}
        <span className="flex-1 bg-primary" style={{ width: percent(values.fullDayMin - grace) }} />
        {values.overtimeMin > 0 ? (
          <span
            className="border border-dashed border-primary bg-[repeating-linear-gradient(135deg,#f5b700_0_4px,#fff_4px_8px)]"
            style={{ width: percent(values.overtimeMin) }}
          />
        ) : null}
      </div>
      <div aria-hidden className="tnum mt-1 flex justify-between text-xs font-semibold">
        <span>{values.start}</span>
        <span>{values.end}</span>
        <span>{overtimeEnd}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li>{t("shiftForm.timeline.onTime")}</li>
        <li>{t("shiftForm.timeline.hours")}</li>
        <li>{t("shiftForm.timeline.overtime", { time: overtimeEnd })}</li>
      </ul>
    </div>
  );
}

export function ShiftHelper({ values }: { values: HelperValues }) {
  const { t } = useTranslation();
  const onTime = fromMinutes(toMinutes(values.start) + values.graceMin);
  const nextDay = toMinutes(values.end) < toMinutes(values.start);
  const half = formatDuration(values.halfDayMin);
  const overtime = formatDuration(values.overtimeMin);

  return (
    <section
      aria-live="polite"
      aria-label={t("shiftForm.helperTitle")}
      className="space-y-3 rounded-lg bg-primary-soft p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary-soft-foreground">
          <Sparkles className="size-4" aria-hidden />
          {t("shiftForm.helperTitle")}
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">{t("shiftForm.live")}</span>
      </div>
      <Timeline values={values} onTime={onTime} overtimeFrom={values.end} />
      <ul className="space-y-2">
        <Line icon={Clock}>{t("shiftForm.onTime", { time: onTime, start: values.start })}</Line>
        <Line icon={CornerUpRight}>
          {t("shiftForm.fullDay", {
            duration: formatDuration(values.fullDayMin),
            time: onTime,
            end: values.end,
          })}
        </Line>
        <Line icon={LogOut}>{t("shiftForm.earlyExit", { end: values.end })}</Line>
        <Line icon={Split}>{t("shiftForm.halfDayLine", { half })}</Line>
        <Line icon={Hourglass}>
          {t("shiftForm.overtimeHint", { end: values.end, ot: overtime })}
        </Line>
        {nextDay ? <Line icon={Moon}>{t("shiftForm.nightNote")}</Line> : null}
      </ul>
    </section>
  );
}
