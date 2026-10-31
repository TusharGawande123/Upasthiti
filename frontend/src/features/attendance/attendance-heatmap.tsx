// The 12-month heatmap on the employee's Attendance tab (F-60): one small square for every day with
// its colour AND its register code inside, a legend, and every square is a button that opens the
// day drawer. On a phone the months stack as rows; the page never scrolls sideways.
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CodeLegend, DASH } from "./register-shared";
import { FAMILY_COLOURS, familyOfCode } from "./status-chip";
import { useEmployeeYear, type YearMonth } from "./use-day-detail";

const WEEKDAY_LETTERS = [
  { key: "mon", letter: "M" },
  { key: "tue", letter: "T" },
  { key: "wed", letter: "W" },
  { key: "thu", letter: "T" },
  { key: "fri", letter: "F" },
  { key: "sat", letter: "S" },
  { key: "sun", letter: "S" },
];

/** 0 for Monday ... 6 for Sunday, for the first day of a "YYYY-MM" month. */
function mondayFirstWeekday(month: string): number {
  const first = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  return (first.getUTCDay() + 6) % 7;
}

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function MonthBlock({
  month,
  employeeName,
  onOpen,
}: {
  month: YearMonth;
  employeeName: string;
  onOpen: (date: string) => void;
}) {
  const { t } = useTranslation();
  const presentCount = month.days.filter((day) => day.code === "P").length;
  const blanks = Array.from({ length: mondayFirstWeekday(month.month) }, (_, index) => index);
  return (
    <section aria-label={monthTitle(month.month)} className="min-w-0">
      <p className="mb-1 flex justify-between text-sm font-bold">
        <span>{monthTitle(month.month)}</span>
        <span className="font-normal text-muted-foreground">
          {t("attendance.employee.presentCount", { count: presentCount })}
        </span>
      </p>
      <div className="grid grid-cols-7 gap-1" aria-hidden>
        {WEEKDAY_LETTERS.map((weekday) => (
          <span key={weekday.key} className="text-center text-[11px] text-muted-foreground">
            {weekday.letter}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {blanks.map((blank) => (
          <span key={`blank-${blank}`} aria-hidden />
        ))}
        {month.days.map((day) => {
          const family = familyOfCode(day.code);
          const dayNumber = Number(day.date.slice(8));
          if (family === "none") {
            return (
              <span
                key={day.date}
                role="img"
                aria-label={t("attendance.register.none")}
                className="grid h-9 place-items-center text-xs text-muted-foreground"
              >
                {DASH}
              </span>
            );
          }
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onOpen(day.date)}
              aria-label={t("attendance.register.cellLabel", {
                name: employeeName,
                day: `${dayNumber}/${month.month.slice(5, 7)}`,
                code: day.code,
                corrected: day.is_corrected ? t("attendance.register.correctedWord") : "",
              })}
              className={cn(
                "relative grid h-9 min-w-0 cursor-pointer place-items-center rounded-md border border-transparent font-mono text-[10px] font-bold hover:ring-2 hover:ring-primary/40",
                FAMILY_COLOURS[family],
              )}
            >
              {day.code}
              {day.is_corrected ? (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-black"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function AttendanceHeatmap({
  employeeId,
  employeeName,
  onOpen,
}: {
  employeeId: string;
  employeeName: string;
  onOpen: (date: string) => void;
}) {
  const { t } = useTranslation();
  const year = useEmployeeYear(employeeId);
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold">{t("attendance.employee.last12")}</h2>
        <p className="text-sm text-muted-foreground">{t("attendance.employee.last12Hint")}</p>
      </div>
      {year.isPending ? <Skeleton className="h-64" /> : null}
      {year.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("attendance.error.title")}
        </p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {year.data?.months.map((month) => (
          <MonthBlock key={month.month} month={month} employeeName={employeeName} onOpen={onOpen} />
        ))}
      </div>
      <CodeLegend />
    </div>
  );
}
