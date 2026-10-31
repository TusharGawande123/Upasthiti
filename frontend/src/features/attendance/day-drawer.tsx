// The day timeline drawer (spec M5 §4.6, design gate B screen 4): one person, one day. A side sheet
// on wide screens and a full-screen sheet on a phone. It shows the rules of the shift, the result
// of the day, "Explain this day" (sentences the server built, written here from translation keys)
// and the timeline. The buttons follow the flags the server sends (`can_correct`, `can_request`).

import type { TFunction } from "i18next";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  Pencil,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useEmployee } from "@/features/employees/use-employees";
import { addDays } from "@/lib/dates";
import { formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addMinutesToClock, clockText, formatDay, formatDuration } from "./attendance-format";
import { CorrectionDialog } from "./correction-dialog";
import { DayTimeline } from "./day-timeline";
import { StatusChip } from "./status-chip";
import { type DayDetail, useDayDetail } from "./use-day-detail";
import { useDayDrawer } from "./use-day-drawer";

const DASH = "–";

/** "2026-10-29T23:30:00Z" -> "05:00 on 30/10/2026" (IST). */
function momentText(moment: string, t: TFunction): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(moment),
  );
  return t("attendance.day.at", { time: formatTime(moment), date: formatDay(date) });
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border bg-card p-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="tnum text-lg font-bold">{children}</p>
    </div>
  );
}

function RulesBox({ detail }: { detail: DayDetail }) {
  const { t } = useTranslation();
  const rules = detail.shift_rules;
  if (!rules) return null;
  return (
    <div className="space-y-1 rounded-md border border-primary/25 bg-primary-soft p-3 text-sm text-primary-soft-foreground">
      <p className="font-bold">
        {t("attendance.day.rulesLine", {
          shift: detail.day.shift?.name ?? "",
          start: clockText(rules.start_time),
          end: clockText(rules.end_time),
          full: formatDuration(rules.shift_length_min),
        })}
      </p>
      <p>
        {t("attendance.day.toleranceLine", {
          onTime: addMinutesToClock(rules.start_time, rules.grace_min),
          leave: clockText(rules.end_time),
        })}
      </p>
      <p className="text-[13px]">
        {t("attendance.day.halfDayLine", {
          half: formatDuration(rules.half_day_min),
          end: clockText(rules.end_time),
          minimum: formatDuration(rules.overtime_min_minutes),
        })}
        {detail.window
          ? ` ${t("attendance.day.window", {
              from: momentText(detail.window.start, t),
              to: momentText(detail.window.end, t),
            })}`
          : ""}
      </p>
    </div>
  );
}

function DayBody({ detail, isSuperAdmin }: { detail: DayDetail; isSuperAdmin: boolean }) {
  const { t } = useTranslation();
  const { day } = detail;
  const timeOrDash = (moment: string | null) => (moment ? formatTime(moment) : DASH);
  const minutesOrDash = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : DASH);
  return (
    <div className="space-y-4">
      <RulesBox detail={detail} />
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <ShieldCheck className="size-4" aria-hidden />
        {t(detail.can_correct ? "attendance.day.roleSuper" : "attendance.day.roleHead")}
      </p>
      {detail.shift_swap ? (
        <Alert>
          <RefreshCw aria-hidden />
          <span>
            {t("attendance.swap.line", {
              shift: detail.shift_swap.shift.name,
              date: formatDay(day.date),
            })}
          </span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip day={day} />
        {day.is_corrected ? (
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold">
            <Pencil className="size-3.5" aria-hidden />
            {t("attendance.mark.corrected")}
          </span>
        ) : null}
        {day.pending_corrections > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#eaeefb] px-2.5 py-1 text-xs font-bold text-[#1a3282]">
            {t("attendance.day.pendingCount", { count: day.pending_corrections })}
          </span>
        ) : null}
      </div>
      {day.exceptions.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {day.exceptions.map((code) => (
            <li key={code} className="flex items-center gap-1.5">
              <Info className="size-4 shrink-0 text-[#8f5300]" aria-hidden />
              {t(`attendanceExceptions.${code}`, { defaultValue: code })}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label={t("attendance.day.result.in")}>{timeOrDash(day.first_in)}</Tile>
        <Tile label={t("attendance.day.result.out")}>{timeOrDash(day.last_out)}</Tile>
        <Tile label={t("attendance.day.result.worked")}>{minutesOrDash(day.worked_min)}</Tile>
        <Tile label={t("attendance.day.result.status")}>
          {day.status_min !== null && day.shift_length_min
            ? t("attendance.hoursOf", {
                worked: formatDuration(day.status_min),
                shift: formatDuration(day.shift_length_min),
              })
            : DASH}
        </Tile>
        <Tile label={t("attendance.day.result.payable")}>{minutesOrDash(day.payable_min)}</Tile>
        <Tile label={t("attendance.day.result.late")}>{minutesOrDash(day.late_min)}</Tile>
        <Tile label={t("attendance.day.result.earlyExit")}>
          {minutesOrDash(day.early_exit_min)}
        </Tile>
        <Tile label={t("attendance.day.result.overtime")}>{minutesOrDash(day.overtime_min)}</Tile>
      </dl>

      {detail.explanation.length > 0 ? (
        <section className="space-y-2 rounded-md border bg-card p-3">
          <p className="flex items-center gap-1.5 font-bold">
            <Lightbulb className="size-4 text-primary" aria-hidden />
            {t("attendance.explain.title")}
          </p>
          <ol className="space-y-1.5">
            {detail.explanation.map((sentence, index) => (
              <li key={sentence.key} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <span>{explainText(sentence, t)}</span>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Server className="size-3.5" aria-hidden />
            {t("attendance.explain.source")}
          </p>
        </section>
      ) : null}

      <DayTimeline items={detail.timeline} canOpenPunchLog={isSuperAdmin} />
    </div>
  );
}

/** One server sentence: `attendance.explain.<key>` with its values; a status value gets its word. */
function explainText(sentence: DayDetail["explanation"][number], t: TFunction): string {
  const values: Record<string, string | number | boolean> = { ...sentence.values };
  if (typeof values.status === "string") {
    values.status = t(`attendance.status.${values.status}`, { defaultValue: values.status });
  }
  if (typeof values.paid === "boolean") {
    values.paid = t(values.paid ? "attendance.explain.paid" : "attendance.explain.unpaid");
  }
  return t(`attendance.explain.${sentence.key}`, values);
}

export function DayDrawer({ employeeId, date }: { employeeId: string; date: string }) {
  const { t } = useTranslation();
  const { openDay, closeDay } = useDayDrawer();
  const detail = useDayDetail(employeeId, date);
  const employee = useEmployee(employeeId);
  const [correcting, setCorrecting] = useState(false);
  const person = employee.data?.employee;
  const data = detail.data;
  const kinds = data?.allowed_correction_kinds ?? [];
  const canAct = data && kinds.length > 0 && (data.can_correct || data.can_request);
  const isLastDay = date >= todayIst();

  return (
    <>
      <DialogPrimitive.Root open onOpenChange={(open) => !open && closeDay()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-background shadow-lg sm:max-w-[580px] motion-safe:animate-in motion-safe:slide-in-from-right"
          >
            <header className="flex items-center gap-2 border-b bg-card p-4">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="truncate text-lg font-bold">
                  {person?.full_name ?? t("attendance.day.title")}
                </DialogPrimitive.Title>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[person?.employee_code, formatDay(date), data?.day.plant?.code]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.filter.previousDay")}
                onClick={() => openDay(employeeId, addDays(date, -1))}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.filter.nextDay")}
                disabled={isLastDay}
                onClick={() => openDay(employeeId, addDays(date, 1))}
              >
                <ChevronRight aria-hidden />
              </Button>
              <DialogPrimitive.Close
                aria-label={t("common.close")}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
              >
                <X aria-hidden />
              </DialogPrimitive.Close>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {detail.isPending ? (
                <div className="space-y-3" aria-busy="true">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-32" />
                  <Skeleton className="h-48" />
                </div>
              ) : detail.isError ? (
                <div className="space-y-3">
                  <Alert tone="danger">{describeError(detail.error, t)}</Alert>
                  <Button variant="outline" onClick={() => detail.refetch()}>
                    {t("common.tryAgain")}
                  </Button>
                </div>
              ) : data ? (
                <DayBody detail={data} isSuperAdmin={data.can_correct} />
              ) : null}
            </div>

            {canAct && data ? (
              <footer className="space-y-2 border-t bg-card p-4">
                <Button size="lg" className="w-full" onClick={() => setCorrecting(true)}>
                  <Pencil aria-hidden />
                  {t(data.can_correct ? "attendance.day.correct" : "attendance.day.ask")}
                </Button>
                <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Info className="size-4 shrink-0" aria-hidden />
                  {t(data.can_correct ? "attendance.day.footSuper" : "attendance.day.footHead")}
                </p>
                {data.can_correct ? (
                  <Link
                    to="/admin/punches"
                    className="inline-block text-[13px] font-semibold text-primary underline"
                  >
                    {t("attendance.day.openPunchLog")}
                  </Link>
                ) : null}
              </footer>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {correcting && data ? (
        <CorrectionDialog
          employee={{
            id: employeeId,
            name: person?.full_name ?? "",
            code: person?.employee_code ?? "",
          }}
          date={date}
          kinds={kinds}
          canCorrect={data.can_correct}
          timeline={data.timeline}
          shiftRules={data.shift_rules}
          startKind={data.day.status === "short_hours" ? "set_status" : undefined}
          subtitle={[person?.full_name, person?.employee_code, formatDay(date)]
            .filter(Boolean)
            .join(" · ")}
          onClose={() => setCorrecting(false)}
        />
      ) : null}
    </>
  );
}
