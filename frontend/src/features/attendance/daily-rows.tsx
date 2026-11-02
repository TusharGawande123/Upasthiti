// The rows of the attendance list: a table from 768 px and one card per person below that
// (design gate B, screen 1). Each row opens the day drawer through `openDay`.
import { Clock, Flag, NotebookPen, Pencil, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTime } from "@/lib/format";
import { formatDuration } from "./attendance-format";
import { StatusChip } from "./status-chip";
import type { DailyItem, Day } from "./use-attendance-admin";

const DASH = "–";

function minutesOrDash(minutes: number): string {
  return minutes > 0 ? formatDuration(minutes) : DASH;
}

/** "7 h 20 m of 8 h" for a person judged on shift hours, plain worked time otherwise. */
function hoursText(day: Day, t: (key: string, values?: Record<string, string>) => string): string {
  if (day.status_min !== null && day.shift_length_min) {
    return t("attendance.hoursOf", {
      worked: formatDuration(day.status_min),
      shift: formatDuration(day.shift_length_min),
    });
  }
  return day.worked_min > 0 ? formatDuration(day.worked_min) : DASH;
}

/** For today: "Inside since 07:04", "Not arrived yet" or "Left at 15:02". */
function InProgressLine({ day }: { day: Day }) {
  const { t } = useTranslation();
  if (day.status !== "open") return null;
  if (day.open_state === "inside" && day.first_in) {
    return (
      <span className="block text-xs text-muted-foreground">
        {t("attendance.inProgress.inside", { time: formatTime(day.first_in) })}
      </span>
    );
  }
  if (day.open_state === "left" && day.last_out) {
    return (
      <span className="block text-xs text-muted-foreground">
        {t("attendance.inProgress.left", { time: formatTime(day.last_out) })}
      </span>
    );
  }
  return (
    <span className="block text-xs text-muted-foreground">
      {t("attendance.inProgress.notArrived")}
    </span>
  );
}

/** Small icons with words for corrected, waiting correction, flagged punch, extra punches and
 * exceptions. The words are for screen readers and tooltips; the icons are the quick cue. */
export function Marks({ day }: { day: Day }) {
  const { t } = useTranslation();
  const marks: { key: string; icon: typeof Pencil; text: string; count?: number }[] = [];
  if (day.is_corrected)
    marks.push({ key: "corrected", icon: Pencil, text: t("attendance.mark.corrected") });
  if (day.pending_corrections > 0)
    marks.push({ key: "pending", icon: Clock, text: t("attendance.mark.pending") });
  if (day.uses_unchecked_flag)
    marks.push({ key: "flagged", icon: Flag, text: t("attendance.mark.flagged") });
  if (day.extra_punch_count > 0)
    marks.push({ key: "extra", icon: NotebookPen, text: t("attendance.mark.extra") });
  if (day.exceptions.length > 0) {
    marks.push({
      key: "exceptions",
      icon: TriangleAlert,
      text: day.exceptions.map((code) => t(`attendanceExceptions.${code}`)).join(" "),
      count: day.exceptions.length,
    });
  }
  if (marks.length === 0) return <span>{DASH}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {marks.map(({ key, icon: Icon, text, count }) => (
        <span
          key={key}
          title={text}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold"
        >
          <Icon className="size-3.5" aria-hidden />
          {count ? <span className="tnum">{count}</span> : null}
          <span className="sr-only">{text}</span>
        </span>
      ))}
    </span>
  );
}

function PersonCell({ item }: { item: DailyItem }) {
  const { employee, day } = item;
  return (
    <>
      <span className="block font-bold">{employee.name}</span>
      <span className="block text-xs text-muted-foreground">
        <span className="font-mono font-semibold">{employee.code}</span>
        {" · "}
        {[day.shift?.name, day.plant?.code].filter(Boolean).join(" · ")}
      </span>
    </>
  );
}

type RowsProps = {
  items: DailyItem[];
  openDay: (employeeId: string, date: string) => void;
};

function DayTable({ items, openDay }: RowsProps) {
  const { t } = useTranslation();
  const columns = ["employee", "status", "in", "out", "hours", "late", "earlyExit", "overtime"];
  return (
    <div className="hidden md:block">
      <Table className="min-w-[60rem]">
        <TableHeader>
          <TableRow className="hover:bg-muted">
            {columns.map((column) => (
              <TableHead key={column}>{t(`attendance.col.${column}`)}</TableHead>
            ))}
            <TableHead>{t("attendance.col.marks")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("attendance.openDay")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const { employee, day } = item;
            return (
              <TableRow
                key={employee.id}
                className="cursor-pointer"
                onClick={() => openDay(employee.id, day.date)}
              >
                <TableCell>
                  <PersonCell item={item} />
                </TableCell>
                <TableCell>
                  <StatusChip day={day} />
                  <InProgressLine day={day} />
                </TableCell>
                <TableCell className="tnum">
                  {day.first_in ? formatTime(day.first_in) : DASH}
                </TableCell>
                <TableCell className="tnum">
                  {day.last_out ? formatTime(day.last_out) : DASH}
                </TableCell>
                <TableCell className="tnum">{hoursText(day, t)}</TableCell>
                <TableCell className="tnum">{minutesOrDash(day.late_min)}</TableCell>
                <TableCell className="tnum">{minutesOrDash(day.early_exit_min)}</TableCell>
                <TableCell className="tnum">{minutesOrDash(day.overtime_min)}</TableCell>
                <TableCell>
                  <Marks day={day} />
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`${t("attendance.openDay")}: ${employee.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openDay(employee.id, day.date);
                    }}
                  >
                    {t("attendance.openDay")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted p-2 text-center">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="tnum block text-sm font-bold">{value}</span>
    </div>
  );
}

function DayCards({ items, openDay }: RowsProps) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y md:hidden">
      {items.map((item) => {
        const { employee, day } = item;
        return (
          <li key={employee.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <PersonCell item={item} />
              </div>
              <div className="shrink-0 text-right">
                <StatusChip day={day} />
                <InProgressLine day={day} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile
                label={t("attendance.col.in")}
                value={day.first_in ? formatTime(day.first_in) : DASH}
              />
              <Tile
                label={t("attendance.col.out")}
                value={day.last_out ? formatTime(day.last_out) : DASH}
              />
              <Tile label={t("attendance.col.hours")} value={hoursText(day, t)} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                {t("attendance.col.late")}: <b className="tnum">{minutesOrDash(day.late_min)}</b>
              </span>
              <span>
                {t("attendance.col.earlyExit")}:{" "}
                <b className="tnum">{minutesOrDash(day.early_exit_min)}</b>
              </span>
              <span>
                {t("attendance.col.overtime")}:{" "}
                <b className="tnum">{minutesOrDash(day.overtime_min)}</b>
              </span>
            </div>
            <Marks day={day} />
            <Button
              variant="outline"
              size="lg"
              className="h-12 w-full"
              aria-label={`${t("attendance.openDay")}: ${employee.name}`}
              onClick={() => openDay(employee.id, day.date)}
            >
              {t("attendance.openDay")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function DayRows(props: RowsProps) {
  return (
    <>
      <DayTable {...props} />
      <DayCards {...props} />
    </>
  );
}
