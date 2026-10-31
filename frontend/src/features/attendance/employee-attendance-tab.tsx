// The "Attendance" tab of the employee page (spec M5 §4.5, design gate B screen 3): a calendar of the
// chosen month with a status chip on every day, the month totals (same as the register), the
// corrections and leave of the month, the one-day shift swap and the 12-month heatmap. Every day
// opens the day drawer, where the correction buttons are. Loaded on demand (lazy) by the page.
import { CalendarHeart, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDay } from "./attendance-format";
import { AttendanceHeatmap } from "./attendance-heatmap";
import { DayDrawerHost } from "./day-drawer-host";
import { CodeLegend, DASH, totalColumns } from "./register-shared";
import { ShiftSwapCard } from "./shift-swap-card";
import { FAMILY_COLOURS, familyOfCode } from "./status-chip";
import type { Day } from "./use-attendance-admin";
import { useEmployeeMonth } from "./use-day-detail";
import { useDayDrawer } from "./use-day-drawer";

type Props = {
  employee: { id: string; full_name: string; plant_id: string };
  isSuperAdmin: boolean;
};

/** "2026-10" moved by `step` months. */
function moveMonth(month: string, step: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + step;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function daysInMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function CalendarDay({
  date,
  day,
  employeeName,
  onOpen,
}: {
  date: string;
  day: Day | undefined;
  employeeName: string;
  onOpen: (date: string) => void;
}) {
  const { t } = useTranslation();
  const dayNumber = Number(date.slice(8));
  const family = day ? familyOfCode(day.code) : "none";
  if (!day || family === "none") {
    return (
      <div
        className="flex min-h-14 flex-col rounded-md border border-dashed p-1 text-[11px] text-muted-foreground"
        role="img"
        aria-label={t("attendance.register.none")}
      >
        {dayNumber}
        <span className="mt-auto text-center">{DASH}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      aria-label={t("attendance.register.cellLabel", {
        name: employeeName,
        day: dayNumber,
        code: day.code,
        corrected: day.is_corrected ? t("attendance.register.correctedWord") : "",
      })}
      className={cn(
        "relative flex min-h-14 min-w-0 cursor-pointer flex-col rounded-md border border-transparent p-1 text-left hover:ring-2 hover:ring-primary/40",
        FAMILY_COLOURS[family],
      )}
    >
      <span className="text-[11px]">{dayNumber}</span>
      <span className="font-mono text-sm font-bold">{day.code}</span>
      {day.first_in ? (
        <span className="tnum hidden text-[10px] sm:block">
          {formatTime(day.first_in)}–{day.last_out ? formatTime(day.last_out) : ""}
        </span>
      ) : null}
      {day.is_corrected ? (
        <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-black" />
      ) : null}
    </button>
  );
}

export function EmployeeAttendanceTab({ employee, isSuperAdmin }: Props) {
  const { t } = useTranslation();
  const { openDay } = useDayDrawer();
  const thisMonth = todayIst().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const data = useEmployeeMonth(employee.id, month);

  const byDate = new Map(data.data?.days.map((day) => [day.date, day]));
  const firstWeekday =
    (new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).getUTCDay() +
      6) %
    7;
  const dates = Array.from(
    { length: daysInMonth(month) },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  const blanks = Array.from({ length: firstWeekday }, (_, index) => index);
  const leave = (data.data?.leave ?? []).filter((item) => !item.cancelled);
  const corrections = data.data?.corrections ?? [];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{monthLabel(month)}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("attendance.employee.openDayHint")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.employee.previousMonth")}
                onClick={() => setMonth(moveMonth(month, -1))}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Input
                type="month"
                className="w-44"
                value={month}
                max={thisMonth}
                aria-label={t("attendance.register.month")}
                onChange={(event) => event.target.value && setMonth(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.employee.nextMonth")}
                disabled={month >= thisMonth}
                onClick={() => setMonth(moveMonth(month, 1))}
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.isError ? (
              <Alert tone="danger">
                <span>{describeError(data.error, t)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => data.refetch()}
                >
                  {t("common.tryAgain")}
                </Button>
              </Alert>
            ) : null}
            {data.isPending ? <Skeleton className="h-72" /> : null}
            {data.data ? (
              <>
                <div className="grid grid-cols-7 gap-1" aria-hidden>
                  {WEEKDAYS.map((weekday) => (
                    <span key={weekday} className="text-center text-xs text-muted-foreground">
                      {t(`attendance.employee.weekday.${weekday}`)}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {blanks.map((blank) => (
                    <span key={`blank-${blank}`} aria-hidden />
                  ))}
                  {dates.map((date) => (
                    <CalendarDay
                      key={date}
                      date={date}
                      day={byDate.get(date)}
                      employeeName={employee.full_name}
                      onOpen={(chosen) => openDay(employee.id, chosen)}
                    />
                  ))}
                </div>
                <CodeLegend />
              </>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("attendance.employee.monthTotals")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.data ? (
                <dl className="grid grid-cols-2 gap-2">
                  {totalColumns(data.data.totals, t).map((column) => (
                    <div key={column.key} className="min-w-0 rounded-md border p-2.5">
                      <dt className="text-xs text-muted-foreground">{column.label}</dt>
                      <dd className="tnum text-lg font-bold">{column.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Skeleton className="h-40" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("attendance.employee.corrections")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.data && leave.length === 0 && corrections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("attendance.employee.noneThisMonth")}
                </p>
              ) : null}
              <ul className="divide-y">
                {leave.map((item) => (
                  <li key={item.id} className="flex gap-3 py-2.5 text-sm">
                    <CalendarHeart className="mt-0.5 size-4 shrink-0 text-[#1a3282]" aria-hidden />
                    <span>
                      <b>{item.is_paid ? t("attendance.code.PL") : t("attendance.code.UL")}</b>
                      <span className="block text-[13px] text-muted-foreground">
                        {formatDay(item.from_date)} – {formatDay(item.to_date)}
                        {item.reason ? ` · ${item.reason}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
                {corrections.map((item) => (
                  <li key={item.id} className="flex gap-3 py-2.5 text-sm">
                    <Pencil className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <b>{t(`corrections.kind.${item.kind}`)}</b>{" "}
                      <span className="text-[13px] font-semibold text-muted-foreground">
                        {t(`corrections.state.${item.state}`)}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {formatDay(item.attendance_date)} ·{" "}
                        {t("corrections.askedBy", { name: item.requested_by.name })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <ShiftSwapCard
            employeeId={employee.id}
            plantId={employee.plant_id}
            isSuperAdmin={isSuperAdmin}
          />
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <AttendanceHeatmap
            employeeId={employee.id}
            employeeName={employee.full_name}
            onOpen={(date) => openDay(employee.id, date)}
          />
        </CardContent>
      </Card>
      <DayDrawerHost />
    </div>
  );
}
