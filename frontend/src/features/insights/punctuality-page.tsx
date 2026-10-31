// Punctuality (/admin/insights/punctuality, spec M5 F-9 and §7 rule 21, design gate C screen 6):
// how on time permanent employees come, by week, group and weekday. Every number is worked out by
// the server; this page asks for the period and the period just before it (for the arrows), and
// shows the same numbers as charts and as tables.
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CircleCheck,
  Clock,
  Info,
  LogOut,
  Minus,
  RotateCcw,
  TrendingUp,
  UserX,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { DemoChip, DemoSwitch, PlantPicker } from "@/features/dashboard/dashboard-controls";
import { useDemoSwitch } from "@/features/dashboard/use-dashboard";
import { formatNumber, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BELOW_PERCENT, WeekdayChart, WeeklyChart } from "./punctuality-charts";
import {
  daysInPeriod,
  type GroupBy,
  MAX_PERIOD_DAYS,
  type Period,
  type PunctualityGroup,
  type PunctualityResponse,
  previousPeriod,
  usePunctuality,
} from "./use-punctuality";

const GROUPS: GroupBy[] = ["department", "category", "shift", "weekday"];
const WEEKDAY_NUMBERS = ["1", "2", "3", "4", "5", "6", "7"];

function shiftDay(isoDate: string, days: number): string {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

function lastThirtyDays(): Period {
  const today = todayIst();
  return { dateFrom: shiftDay(today, -29), dateTo: today };
}

/** The change against the period before: an arrow AND a word, so colour is never the only cue. */
type Change = { direction: "up" | "down" | "same"; key: string; value: number; good: boolean };

function change(
  now: number,
  before: number,
  higherIsBetter: boolean,
  keys: { up: string; down: string },
): Change {
  const difference = Math.round((now - before) * 10) / 10;
  if (difference === 0) {
    return { direction: "same", key: "insights.punctuality.delta.same", value: 0, good: true };
  }
  const up = difference > 0;
  return {
    direction: up ? "up" : "down",
    key: up ? keys.up : keys.down,
    value: Math.abs(difference),
    good: up === higherIsBetter,
  };
}

function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  delta,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
  delta: Change | null;
}) {
  const { t } = useTranslation();
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;
  return (
    <Card className="space-y-1 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
      </p>
      <p className="tnum text-3xl font-extrabold">
        {value}
        <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>
      </p>
      <p className="min-h-5 text-[13px]">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-start gap-1 font-semibold",
              delta.good ? "text-success" : "text-warning",
            )}
          >
            <DeltaIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(delta.key, { value: delta.value })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("insights.punctuality.noComparison")}</span>
        )}
      </p>
    </Card>
  );
}

function Kpis({
  now,
  before,
}: {
  now: PunctualityResponse;
  before: PunctualityResponse | undefined;
}) {
  const { t } = useTranslation();
  const p = "insights.punctuality.delta";
  // With no arrivals before, there is nothing to compare with.
  const compare = before && before.arrivals > 0 ? before : undefined;
  const onTime = compare
    ? change(now.on_time_percent, compare.on_time_percent, true, {
        up: `${p}.pointsUp`,
        down: `${p}.pointsDown`,
      })
    : null;
  const late = compare
    ? change(now.late_count, compare.late_count, false, { up: `${p}.more`, down: `${p}.fewer` })
    : null;
  const average = compare
    ? change(now.average_late_min, compare.average_late_min, false, {
        up: `${p}.longer`,
        down: `${p}.shorter`,
      })
    : null;
  const early = compare
    ? change(now.early_exit_count, compare.early_exit_count, false, {
        up: `${p}.more`,
        down: `${p}.fewer`,
      })
    : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        icon={CircleCheck}
        label={t("insights.punctuality.kpi.onTime")}
        value={String(now.on_time_percent)}
        unit="%"
        delta={onTime}
      />
      <KpiTile
        icon={UserX}
        label={t("insights.punctuality.kpi.late")}
        value={formatNumber(now.late_count)}
        unit=""
        delta={late}
      />
      <KpiTile
        icon={Clock}
        label={t("insights.punctuality.kpi.averageLate")}
        value={String(now.average_late_min)}
        unit={t("insights.punctuality.minShort")}
        delta={average}
      />
      <KpiTile
        icon={LogOut}
        label={t("insights.punctuality.kpi.earlyExits")}
        value={formatNumber(now.early_exit_count)}
        unit=""
        delta={early}
      />
    </div>
  );
}

function BelowBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-warning bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">
      <ArrowDown className="size-3" aria-hidden />
      {t("insights.punctuality.below")}
    </span>
  );
}

function GroupLabel({ group, by }: { group: PunctualityGroup; by: GroupBy }) {
  const { t } = useTranslation();
  if (by === "weekday") return t(`insights.punctuality.weekday.${Number.parseInt(group.key, 10)}`);
  return group.label || t("insights.punctuality.noValue");
}

function GroupCard({ groups, by }: { groups: PunctualityGroup[]; by: GroupBy }) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="text-base font-bold">{t(`insights.punctuality.by.${by}`)}</h2>
        <p className="text-[13px] text-muted-foreground">{t("insights.punctuality.barNote")}</p>
      </div>
      <ul className="space-y-2 p-4">
        {groups.map((group) => {
          const below = group.on_time_percent < BELOW_PERCENT;
          return (
            <li
              key={group.key}
              className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 sm:grid-cols-[9rem_1fr_5rem]"
            >
              <span className="truncate text-sm font-semibold">
                <GroupLabel group={group} by={by} />
              </span>
              <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", below ? "bg-warning" : "bg-primary")}
                  style={{
                    width: `${Math.min(100, group.on_time_percent)}%`,
                    backgroundImage: below
                      ? "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 4px, transparent 4px 8px)"
                      : undefined,
                  }}
                />
              </span>
              <span className="tnum text-right text-sm font-bold">
                {below ? "▼ " : ""}
                {group.on_time_percent}%
              </span>
            </li>
          );
        })}
      </ul>
      <div className="overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`insights.punctuality.group.${by}`)}</TableHead>
              <TableHead className="text-right">
                {t("insights.punctuality.col.daysWithIn")}
              </TableHead>
              <TableHead className="text-right">{t("insights.punctuality.col.onTime")}</TableHead>
              <TableHead className="text-right">
                {t("insights.punctuality.col.lateArrivals")}
              </TableHead>
              <TableHead className="text-right">
                {t("insights.punctuality.col.averageLate")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.key}>
                <TableCell className="font-semibold">
                  <GroupLabel group={group} by={by} />
                </TableCell>
                <TableCell className="tnum text-right">{formatNumber(group.arrivals)}</TableCell>
                <TableCell className="tnum text-right font-bold">
                  <span className="inline-flex items-center justify-end gap-2">
                    {group.on_time_percent < BELOW_PERCENT ? <BelowBadge /> : null}
                    {group.on_time_percent}%
                  </span>
                </TableCell>
                <TableCell className="tnum text-right">{formatNumber(group.late_count)}</TableCell>
                <TableCell className="tnum text-right">
                  {group.average_late_min} {t("insights.punctuality.minShort")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function TopLateCard({ rows }: { rows: PunctualityResponse["top_late"] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="text-base font-bold">{t("insights.punctuality.top.title")}</h2>
        <p className="text-[13px] text-muted-foreground">
          {t("insights.punctuality.top.subtitle")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t("insights.punctuality.col.employee")}</TableHead>
              <TableHead className="text-right">{t("insights.punctuality.col.late")}</TableHead>
              <TableHead className="text-right">
                {t("insights.punctuality.col.totalLate")}
              </TableHead>
              <TableHead>
                <span className="sr-only">{t("insights.punctuality.viewMonth")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.employee.id}>
                <TableCell className="tnum font-bold">{index + 1}</TableCell>
                <TableCell>
                  <span className="block font-semibold">{row.employee.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.employee.code}
                  </span>
                </TableCell>
                <TableCell className="tnum text-right font-bold">
                  {t("insights.punctuality.lateDays", { count: row.late_count })}
                </TableCell>
                <TableCell className="tnum text-right">
                  {row.late_min} {t("insights.punctuality.minShort")}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/admin/employees/${row.employee.id}?tab=attendance`}
                    className="inline-flex items-center gap-1 font-semibold text-primary underline"
                  >
                    <CalendarDays className="size-4" aria-hidden />
                    {t("insights.punctuality.viewMonth")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export function PunctualityPage() {
  const { t } = useTranslation();
  const me = useMe();
  const { plantId } = usePlantFilter();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const [period, setPeriod] = useState<Period>(lastThirtyDays);
  const [groupBy, setGroupBy] = useState<GroupBy>("department");

  const days = daysInPeriod(period);
  const tooLong = days > MAX_PERIOD_DAYS;
  const backwards = days < 1 || Number.isNaN(days);
  const valid = !tooLong && !backwards;
  const scope = { ...period, plantId, includeDemo: showDemo, groupBy };
  const main = usePunctuality(scope, valid);
  const before = usePunctuality({ ...scope, ...previousPeriod(period) }, valid);
  // The weekday columns always show weekdays, whatever the table below is grouped by.
  const weekdays = usePunctuality({ ...scope, groupBy: "weekday" }, valid && groupBy !== "weekday");
  const weekdayGroups = groupBy === "weekday" ? main.data?.groups : weekdays.data?.groups;

  const data = main.data;
  const weekdayPoints = WEEKDAY_NUMBERS.flatMap((number) => {
    const found = weekdayGroups?.find((group) => Number.parseInt(group.key, 10) === Number(number));
    return found
      ? [
          {
            name: t(`insights.punctuality.weekdayShort.${number}`),
            value: found.on_time_percent,
          },
        ]
      : [];
  });

  const set = (changes: Partial<Period>) => setPeriod((current) => ({ ...current, ...changes }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            {t("insights.punctuality.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("insights.punctuality.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showDemo ? <DemoChip /> : null}
          {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
        </div>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field id="punctuality-from" label={t("reports.field.from")}>
              <Input
                id="punctuality-from"
                type="date"
                value={period.dateFrom}
                max={period.dateTo || undefined}
                aria-invalid={!valid}
                onChange={(event) => set({ dateFrom: event.target.value })}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field id="punctuality-to" label={t("reports.field.to")}>
              <Input
                id="punctuality-to"
                type="date"
                value={period.dateTo}
                max={todayIst()}
                aria-invalid={!valid}
                onChange={(event) => set({ dateTo: event.target.value })}
              />
            </Field>
          </div>
          <PlantPicker />
          <Button variant="outline" className="h-10" onClick={() => setPeriod(lastThirtyDays())}>
            <RotateCcw aria-hidden />
            {t("insights.punctuality.last30")}
          </Button>
        </div>
        {tooLong ? (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {t("insights.punctuality.error.range", { days })}
          </p>
        ) : null}
        {backwards ? (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {t("reports.error.order")}
          </p>
        ) : null}
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="float-left mr-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {t("insights.punctuality.groupBy")}
          </legend>
          {GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              aria-pressed={groupBy === group}
              onClick={() => setGroupBy(group)}
              className={cn(
                "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold",
                groupBy === group
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              {groupBy === group ? <Check className="size-4" aria-hidden /> : null}
              {t(`insights.punctuality.group.${group}`)}
            </button>
          ))}
        </fieldset>
      </Card>

      {!valid ? (
        <Card className="flex items-start gap-3 p-6">
          <Info className="size-6 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-lg font-bold">{t("insights.punctuality.chooseShorter")}</p>
        </Card>
      ) : null}

      {valid && main.isError && !data ? (
        <Alert tone="danger">
          <span>
            <strong>{t("insights.punctuality.error.load")}.</strong> {describeError(main.error, t)}
          </span>
          <Button variant="outline" size="sm" onClick={() => main.refetch()}>
            {t("dashboard.live.tryAgain")}
          </Button>
        </Alert>
      ) : null}

      {valid && main.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {["a", "b", "c", "d"].map((id) => (
              <Skeleton key={id} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {valid && data && data.arrivals === 0 ? (
        <Card className="flex items-start gap-3 p-6">
          <Info className="size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-lg font-bold">{t("insights.punctuality.empty.title")}</p>
            <p className="text-muted-foreground">{t("insights.punctuality.empty.body")}</p>
          </div>
        </Card>
      ) : null}

      {valid && data && data.arrivals > 0 ? (
        <>
          <Kpis now={data} before={before.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="flex items-center gap-2 border-b p-4 text-base font-bold">
                <TrendingUp className="size-4 text-primary" aria-hidden />
                {t("insights.punctuality.chart.weekly")}
              </h2>
              <div className="p-3">
                <WeeklyChart points={data.weekly} />
              </div>
            </Card>
            <Card className="overflow-hidden">
              <h2 className="flex items-center gap-2 border-b p-4 text-base font-bold">
                <CalendarDays className="size-4 text-primary" aria-hidden />
                {t("insights.punctuality.chart.weekday")}
              </h2>
              <div className="p-3">
                <WeekdayChart points={weekdayPoints} />
              </div>
            </Card>
          </div>
          <GroupCard groups={data.groups} by={groupBy} />
          <TopLateCard rows={data.top_late} />
        </>
      ) : null}

      <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("insights.punctuality.note")}
      </p>
    </div>
  );
}
