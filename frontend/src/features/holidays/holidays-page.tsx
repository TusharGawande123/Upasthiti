// Holidays (/admin/holidays, spec M5 §4.9, design gate C screen 2): the days the plants are
// closed, one year at a time, grouped by month. Everyone in scope reads; only the Super Admin adds
// and cancels. A cancelled holiday stays in the list with its reason.
import {
  Ban,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  History,
  IndianRupee,
  Plus,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlantFilterSelect, usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddHolidayDialog, CancelHolidayDialog } from "./holiday-dialogs";
import { type Holiday, useHolidays } from "./use-holidays";

const monthFormat = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" });

// Plain dates have no time zone: read them as UTC midnight so the day never shifts.
const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** Holidays are already sorted by date; this keeps them in groups of one month. */
function groupByMonth(holidays: Holiday[]): { heading: string; items: Holiday[] }[] {
  const groups: { heading: string; items: Holiday[] }[] = [];
  for (const holiday of holidays) {
    const heading = monthFormat.format(asDate(holiday.date));
    const last = groups.at(-1);
    if (last?.heading === heading) last.items.push(holiday);
    else groups.push({ heading, items: [holiday] });
  }
  return groups;
}

function PlantsBadge({ holiday }: { holiday: Holiday }) {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral" className="border">
      <Building2 aria-hidden />
      {holiday.all_plants
        ? t("holidays.scope.all")
        : holiday.plants.map((plant) => plant.code).join(", ")}
    </Badge>
  );
}

function HolidayRow({
  holiday,
  today,
  canCancel,
  onCancel,
}: {
  holiday: Holiday;
  today: string;
  canCancel: boolean;
  onCancel: (holiday: Holiday) => void;
}) {
  const { t } = useTranslation();
  const date = asDate(holiday.date);
  const cancelled = holiday.cancelled !== null;
  const past = !cancelled && holiday.date < today;
  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="grid size-14 shrink-0 place-items-center rounded-lg border bg-card text-center leading-tight">
        <span className="tnum text-xl font-bold">{String(date.getUTCDate()).padStart(2, "0")}</span>
        <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
          {weekdayFormat.format(date)}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={cn("font-bold", cancelled && "text-muted-foreground line-through")}>
          {holiday.name}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PlantsBadge holiday={holiday} />
          {holiday.is_paid ? (
            <Badge tone="success">
              <IndianRupee aria-hidden />
              {t("holidays.pay.paidBadge")}
            </Badge>
          ) : (
            <Badge className="border border-dashed border-warning bg-card text-warning">
              <CircleSlash aria-hidden />
              {t("holidays.pay.unpaidBadge")}
            </Badge>
          )}
          {cancelled ? (
            <>
              <Badge className="border border-dashed border-border-strong">
                <Ban aria-hidden />
                {t("holidays.state.cancelled")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("holidays.cancelledWithReason", { reason: holiday.cancelled?.reason })}
              </span>
            </>
          ) : past ? (
            <Badge tone="neutral">
              <History aria-hidden />
              {t("holidays.state.past")}
            </Badge>
          ) : (
            <Badge tone="primary">
              <CircleCheck aria-hidden />
              {t("holidays.state.active")}
            </Badge>
          )}
        </div>
      </div>
      {canCancel && !cancelled ? (
        <Button
          size="sm"
          variant="outline"
          aria-label={`${t("holidays.cancel")}: ${holiday.name}`}
          className="border-destructive text-destructive"
          onClick={() => onCancel(holiday)}
        >
          <X aria-hidden />
          {t("holidays.cancel")}
        </Button>
      ) : null}
    </li>
  );
}

export function HolidaysPage() {
  const { t } = useTranslation();
  const me = useMe();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { plantId } = usePlantFilter();
  const today = todayIst();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Holiday | null>(null);
  const holidays = useHolidays(year, plantId);

  const cancelledCount = holidays.data?.filter((holiday) => holiday.cancelled).length ?? 0;
  const groups = groupByMonth(holidays.data ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("holidays.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t(isSuperAdmin ? "holidays.subtitle.admin" : "holidays.subtitle.readOnly")}
          </p>
        </div>
        {isSuperAdmin ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("holidays.add")}
          </Button>
        ) : null}
      </div>

      {me.data && !isSuperAdmin ? <Alert tone="info">{t("holidays.readOnly")}</Alert> : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <fieldset className="m-0 flex items-center gap-2 border-0 p-0">
            <legend className="sr-only">{t("holidays.year")}</legend>
            <Button
              variant="outline"
              size="sm"
              aria-label={t("holidays.prevYear")}
              onClick={() => setYear(year - 1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tnum min-w-16 text-center text-xl font-bold">{year}</span>
            <Button
              variant="outline"
              size="sm"
              aria-label={t("holidays.nextYear")}
              onClick={() => setYear(year + 1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </fieldset>
          <PlantFilterSelect />
        </div>

        {holidays.isError ? (
          <div className="space-y-3 p-4">
            <Alert tone="danger">
              <span>
                <strong>{t("holidays.loadError")}.</strong> {describeError(holidays.error, t)}
              </span>
            </Alert>
            <Button variant="outline" onClick={() => holidays.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : null}

        {holidays.isPending ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {[1, 2, 3, 4, 5].map((row) => (
              <Skeleton key={row} className="h-16 w-full" />
            ))}
          </div>
        ) : null}

        {holidays.data && holidays.data.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-lg font-bold">{t("holidays.empty.title", { year })}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t(isSuperAdmin ? "holidays.empty.bodyAdmin" : "holidays.empty.bodyReader")}
            </p>
            {isSuperAdmin ? (
              <Button className="mt-4" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t("holidays.add")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.heading} aria-label={group.heading}>
            <h2 className="border-y bg-muted px-4 py-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {group.heading}
            </h2>
            <ul className="divide-y">
              {group.items.map((holiday) => (
                <HolidayRow
                  key={holiday.id}
                  holiday={holiday}
                  today={today}
                  canCancel={isSuperAdmin}
                  onCancel={setCancelling}
                />
              ))}
            </ul>
          </section>
        ))}

        {holidays.data && holidays.data.length > 0 ? (
          <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              {t("holidays.count", { count: holidays.data.length, year })}
              {cancelledCount > 0
                ? ` · ${t("holidays.cancelledCount", { count: cancelledCount })}`
                : ""}
            </span>
            <span>{t("holidays.footer")}</span>
          </div>
        ) : null}
      </Card>

      {adding ? <AddHolidayDialog onClose={() => setAdding(false)} /> : null}
      {cancelling ? (
        <CancelHolidayDialog holiday={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  );
}
