// Pieces shared by the monthly register and the employee's Attendance tab: the twelve month totals
// and the legend of register codes (design gate B).
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDuration } from "./attendance-format";
import { FAMILY_COLOURS, familyOfCode } from "./status-chip";
import type { Totals } from "./use-attendance-admin";

export const DASH = "–";
export const LEGEND_CODES = [
  "P",
  "HD",
  "SH",
  "A",
  "INC",
  "PL",
  "UL",
  "WO",
  "H",
  "WO-W",
  "H-W",
] as const;

/** The twelve month totals, in the order of the register file. */
export function totalColumns(totals: Totals, t: (key: string) => string) {
  return [
    {
      key: "present",
      label: t("attendance.register.total.present"),
      value: String(totals.present),
    },
    {
      key: "halfDay",
      label: t("attendance.register.total.halfDay"),
      value: String(totals.half_day),
    },
    {
      key: "shortHours",
      label: t("attendance.register.total.shortHours"),
      value: String(totals.short_hours),
    },
    { key: "absent", label: t("attendance.register.total.absent"), value: String(totals.absent) },
    {
      key: "leave",
      label: t("attendance.register.total.leave"),
      value: `${totals.leave_paid} / ${totals.leave_unpaid}`,
    },
    {
      key: "weeklyOff",
      label: t("attendance.register.total.weeklyOff"),
      value: String(totals.weekly_off),
    },
    {
      key: "holiday",
      label: t("attendance.register.total.holiday"),
      value: String(totals.holiday),
    },
    {
      key: "workedOffDay",
      label: t("attendance.register.total.workedOffDay"),
      value: String(totals.worked_on_off_day),
    },
    {
      key: "incomplete",
      label: t("attendance.register.total.incomplete"),
      value: String(totals.incomplete),
    },
    {
      key: "workedHours",
      label: t("attendance.register.total.workedHours"),
      value: formatDuration(totals.worked_min),
    },
    {
      key: "overtimeHours",
      label: t("attendance.register.total.overtimeHours"),
      value: formatDuration(totals.overtime_min),
    },
    {
      key: "lateCount",
      label: t("attendance.register.total.lateCount"),
      value: String(totals.late_count),
    },
  ];
}

export function CodeLegend() {
  const { t } = useTranslation();
  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-sm font-bold">{t("attendance.register.legend")}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LEGEND_CODES.map((code) => (
          <li key={code} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "grid h-7 min-w-10 place-items-center rounded-md px-1 font-mono text-xs font-bold",
                FAMILY_COLOURS[familyOfCode(code)],
              )}
            >
              {code}
            </span>
            {t(`attendance.code.${code}`)}
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm">
          <span className="grid h-7 min-w-10 place-items-center text-muted-foreground">{DASH}</span>
          {t("attendance.register.legendNone")}
        </li>
      </ul>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-black" />
        {t("attendance.register.correctedDot")}
      </p>
    </Card>
  );
}
