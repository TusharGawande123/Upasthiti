// My attendance (spec M4b §4.8b, F-73, design gate P1 screen 6): the last 31 days as cards (no
// table, so nothing scrolls sideways). Only the employee's own days; no flags, reasons or review
// marks. Today shows "Open" until the day closes. Corrections stay with the office.
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarHeart,
  CalendarOff,
  CircleCheck,
  CircleHelp,
  CircleX,
  Contrast,
  Globe,
  Hourglass,
  Loader,
  type LucideIcon,
  Smartphone,
  Sun,
  Timer,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { istDateAndTime } from "@/lib/dates";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type AttendanceDay, phoneApi } from "./phone-api";
import { Notice, PhoneCard, PhoneTitle } from "./phone-ui";

const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  present: { icon: CircleCheck, tone: "bg-success-soft text-success" },
  half_day: { icon: Contrast, tone: "bg-warning-soft text-warning" },
  short_hours: { icon: Timer, tone: "bg-warning-soft text-warning" },
  absent: { icon: CircleX, tone: "bg-destructive-soft text-destructive" },
  incomplete: { icon: CircleHelp, tone: "bg-warning-soft text-warning" },
  leave: { icon: CalendarCheck, tone: "bg-primary-soft text-primary" },
  weekly_off: { icon: Sun, tone: "bg-muted text-muted-foreground" },
  holiday: { icon: CalendarHeart, tone: "bg-muted text-muted-foreground" },
  open: { icon: Loader, tone: "border border-dashed border-primary bg-card text-primary" },
};
const QUIET = new Set(["weekly_off", "holiday", "leave"]);

export function weekdayAndDate(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** "7 h 20 m" for a number of minutes; "–" for none. */
export function workedText(minutes: number): string {
  if (minutes <= 0) return "–";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} m` : `${rest} m`;
}

function DayCard({ day, today }: { day: AttendanceDay; today: string }) {
  const { t } = useTranslation();
  const isToday = day.date === today;
  const status = isToday && day.first_in && !day.last_out ? "open" : day.status;
  const look = LOOK[status] ?? { icon: CircleHelp, tone: "bg-muted text-muted-foreground" };
  const Icon = look.icon;
  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 text-lg",
        QUIET.has(status) && "bg-muted/60",
        isToday && "border-l-8 border-l-primary",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          {weekdayAndDate(day.date)}
          {isToday ? (
            <span className="ml-2 text-base text-primary">{t("phone.attendance.todayLabel")}</span>
          ) : null}
        </p>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-semibold",
            look.tone,
          )}
        >
          <Icon className="size-4" aria-hidden />
          {t(`phone.status.${status}`, { defaultValue: status })}
        </span>
      </div>
      {!QUIET.has(status) ? (
        <dl className="mt-2 grid grid-cols-3 gap-2 text-base">
          <div>
            <dt className="text-muted-foreground">{t("phone.attendance.in")}</dt>
            <dd className="font-semibold">
              {day.first_in ? formatTime(day.first_in) : t("phone.attendance.missing")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("phone.attendance.out")}</dt>
            <dd className="font-semibold">
              {day.last_out
                ? formatTime(day.last_out)
                : t(isToday ? "phone.attendance.notYet" : "phone.attendance.missing")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("phone.attendance.worked")}</dt>
            <dd className="font-semibold">{workedText(day.worked_min)}</dd>
          </div>
        </dl>
      ) : null}
      {day.channels.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-2 text-base text-muted-foreground">
          {day.channels.map((channel) => (
            <span key={channel} className="inline-flex items-center gap-1">
              {channel === "phone" ? (
                <Smartphone className="size-4" aria-hidden />
              ) : (
                <Globe className="size-4" aria-hidden />
              )}
              {t(channel === "phone" ? "phone.home.via.phone" : "phone.home.via.device")}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export function PhoneAttendancePage() {
  const { t } = useTranslation();
  const attendance = useQuery({
    queryKey: ["phone", "attendance"],
    queryFn: phoneApi.attendance,
    retry: false,
  });
  const today = istDateAndTime(new Date()).date;

  return (
    <>
      <Link
        to="/phone"
        className="inline-flex items-center gap-2 text-lg font-semibold text-primary"
      >
        <ArrowLeft aria-hidden />
        {t("phone.back")}
      </Link>
      <PhoneTitle hint={t("phone.attendance.subtitle")}>{t("phone.attendance.title")}</PhoneTitle>
      {attendance.isPending ? (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-24 w-full" />
          ))}
        </div>
      ) : attendance.isError ? (
        <Notice tone="danger">{t("phone.attendance.loadError")}</Notice>
      ) : attendance.data.days.length === 0 ? (
        <PhoneCard className="flex items-center gap-3">
          <CalendarOff aria-hidden />
          {t("phone.attendance.empty")}
        </PhoneCard>
      ) : (
        <ul className="space-y-3">
          {attendance.data.days.map((day) => (
            <DayCard key={day.date} day={day} today={today} />
          ))}
        </ul>
      )}
      <p className="flex items-center gap-2 text-lg text-muted-foreground">
        <Hourglass className="size-5" aria-hidden />
        {t("phone.attendance.help")}
      </p>
    </>
  );
}
