// The live part of the dashboard (spec M5 §4.1, design gate A): tiles with today's numbers for one
// plant, or one row per plant for "All plants". Numbers refresh every 30 seconds; a failed
// refresh keeps the last numbers and says so. Every tile links to the attendance list.
import {
  ArrowUpRight,
  CalendarOff,
  CircleAlert,
  Clock,
  DoorOpen,
  HardHat,
  Hourglass,
  Info,
  Plane,
  Scale,
  Sun,
  TriangleAlert,
  UserCheck,
  UserRoundX,
  type Users,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { queryString } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { DemoChip, DemoSwitch, PlantPicker } from "./dashboard-controls";
import {
  type PlantLive,
  type PlantNumbers,
  useDemoSwitch,
  useLiveDashboard,
} from "./use-dashboard";

type Tone = "plain" | "warning" | "danger";

// The attendance list (a later slice) reads `show` to pick the matching filter.
function listLink(show: string, plantId: string): string {
  return `/admin/attendance${queryString({ show, plant_id: plantId })}`;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function weekday(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    timeZone: "UTC",
  });
}

const TILE_BASE =
  "relative flex flex-col gap-2 rounded-xl border bg-card p-4 transition-transform hover:-translate-y-0.5 motion-reduce:transition-none";
const TONE_CLASSES: Record<Tone, string> = {
  plain: "",
  warning: "border-warning/40 bg-warning-soft/40",
  danger: "border-destructive/30 bg-destructive-soft/40",
};

type TileProps = {
  show: string;
  plantId: string;
  icon: typeof Users;
  label: string;
  value: number;
  sub: string;
  tone?: Tone;
};

function Tile({ show, plantId, icon: Icon, label, value, sub, tone = "plain" }: TileProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={listLink(show, plantId)}
      aria-label={t("dashboard.live.tileLabel", { label, count: value })}
      className={cn(TILE_BASE, TONE_CLASSES[tone])}
    >
      <ArrowUpRight className="absolute top-3 right-3 size-4 text-muted-foreground" aria-hidden />
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-5" aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          "tnum text-4xl font-extrabold",
          value === 0 && "text-muted-foreground",
          value > 0 && tone === "warning" && "text-warning",
          value > 0 && tone === "danger" && "text-destructive",
        )}
      >
        {formatNumber(value)}
      </span>
      <span className="text-sm text-muted-foreground">{sub}</span>
    </Link>
  );
}

function InsideHero({ numbers, plantId }: { numbers: PlantNumbers; plantId: string }) {
  const { t } = useTranslation();
  const temporary = numbers.inside_temporary;
  const permanent = numbers.inside_now - temporary;
  const temporaryShare = percent(temporary, numbers.inside_now);
  return (
    <Link
      to={listLink("inside", plantId)}
      aria-label={t("dashboard.live.tileLabel", {
        label: t("dashboard.live.insideNow"),
        count: numbers.inside_now,
      })}
      className={cn(TILE_BASE, "col-span-2")}
    >
      <ArrowUpRight className="absolute top-3 right-3 size-4 text-muted-foreground" aria-hidden />
      <span className="flex items-center gap-2 text-base font-bold">
        <DoorOpen className="size-5 text-primary" aria-hidden />
        {t("dashboard.live.insideNow")}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="tnum text-6xl leading-none font-extrabold">
          {formatNumber(numbers.inside_now)}
        </span>
        <span className="text-lg font-semibold text-muted-foreground">
          {t("dashboard.live.people")}
        </span>
      </span>
      {/* Solid blue = permanent, hatched yellow = temporary: a pattern and words, not colour alone. */}
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="bg-primary" style={{ width: `${100 - temporaryShare}%` }} />
        <div
          className="bg-signal"
          style={{
            width: `${temporaryShare}%`,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)",
          }}
        />
      </div>
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
        <span>{t("dashboard.live.permanent", { count: permanent })}</span>
        <span>{t("dashboard.live.insideTemporary", { count: temporary })}</span>
      </span>
    </Link>
  );
}

function DaysToDecideTile({ numbers, plantId }: { numbers: PlantNumbers; plantId: string }) {
  const { t } = useTranslation();
  const { short_hours, incomplete } = numbers.undecided;
  const total = short_hours + incomplete;
  return (
    <Link
      to={listLink("to_decide", plantId)}
      aria-label={t("dashboard.live.tileLabel", {
        label: t("dashboard.live.daysToDecide"),
        count: total,
      })}
      className={cn(TILE_BASE, TONE_CLASSES.warning, "col-span-2")}
    >
      <ArrowUpRight className="absolute top-3 right-3 size-4 text-muted-foreground" aria-hidden />
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Scale className="size-5" aria-hidden />
        {t("dashboard.live.daysToDecide")}
      </span>
      <span className="flex flex-wrap items-center gap-3">
        <span className="tnum text-4xl font-extrabold">{formatNumber(total)}</span>
        <span className="text-base font-semibold text-muted-foreground">
          {t("dashboard.live.daysToDecideText", { count: total })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-card px-2.5 py-1 text-sm font-bold">
          <Hourglass className="size-4" aria-hidden />
          {t("dashboard.live.shortHours", { count: short_hours })}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-card px-2.5 py-1 text-sm font-bold text-destructive">
          <CircleAlert className="size-4" aria-hidden />
          {t("dashboard.live.incomplete", { count: incomplete })}
        </span>
      </span>
      <span className="text-sm text-muted-foreground">{t("dashboard.live.decideSub")}</span>
    </Link>
  );
}

function TileGrid({ numbers, plantId }: { numbers: PlantNumbers; plantId: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      <InsideHero numbers={numbers} plantId={plantId} />
      <Tile
        show="expected"
        plantId={plantId}
        icon={UsersRound}
        label={t("dashboard.live.expected")}
        value={numbers.expected}
        sub={t("dashboard.live.expectedSub")}
      />
      <Tile
        show="arrived"
        plantId={plantId}
        icon={UserCheck}
        label={t("dashboard.live.arrived")}
        value={numbers.arrived}
        sub={t("dashboard.live.arrivedSub", {
          percent: percent(numbers.arrived, numbers.expected),
        })}
      />
      <Tile
        show="late"
        plantId={plantId}
        icon={Clock}
        label={t("dashboard.live.late")}
        value={numbers.late}
        sub={t("dashboard.live.lateSub")}
        tone="warning"
      />
      <Tile
        show="not_arrived"
        plantId={plantId}
        icon={UserRoundX}
        label={t("dashboard.live.notArrived")}
        value={numbers.not_arrived}
        sub={t("dashboard.live.notArrivedSub")}
        tone="warning"
      />
      <Tile
        show="on_leave"
        plantId={plantId}
        icon={Plane}
        label={t("dashboard.live.onLeave")}
        value={numbers.on_leave}
        sub={t("dashboard.live.onLeaveSub")}
      />
      <Tile
        show="off_today"
        plantId={plantId}
        icon={CalendarOff}
        label={t("dashboard.live.offToday")}
        value={numbers.off_today}
        sub={t("dashboard.live.offTodaySub")}
      />
      <Tile
        show="exceptions"
        plantId={plantId}
        icon={TriangleAlert}
        label={t("dashboard.live.exceptions")}
        value={numbers.exceptions}
        sub={t("dashboard.live.exceptionsSub")}
        tone="danger"
      />
      <DaysToDecideTile numbers={numbers} plantId={plantId} />
    </div>
  );
}

function ContractorCard({ live }: { live: PlantLive }) {
  const { t } = useTranslation();
  const most = Math.max(1, ...live.by_contractor.map((row) => row.inside));
  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-2 text-base font-bold">
        <HardHat className="size-5 text-warning" aria-hidden />
        {t("dashboard.live.temporaryOnSite")}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("dashboard.live.temporarySub", { count: live.inside_temporary })}
      </p>
      <ul className="divide-y">
        {live.by_contractor.map((row) => (
          <li key={row.contractor?.id ?? "none"} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("font-semibold", !row.contractor && "italic")}>
                {row.contractor?.name ?? t("dashboard.live.noContractor")}
              </span>
              <span className="tnum text-lg font-bold">{formatNumber(row.inside)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full bg-signal"
                style={{ width: `${percent(row.inside, most)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ShiftsCard({ live }: { live: PlantLive }) {
  const { t } = useTranslation();
  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-2 text-base font-bold">
        <Sun className="size-5 text-primary" aria-hidden />
        {t("dashboard.live.shifts")}
      </h3>
      <ul className="mt-3 divide-y">
        {live.shifts.map((line) => (
          <li key={String(line.shift.id)} className="space-y-1 py-2">
            <p className="font-bold">
              {line.shift.name}{" "}
              <span className="font-normal text-muted-foreground">
                {line.shift.start_time}–{line.shift.end_time}
              </span>
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold">
              <span>{t("dashboard.live.shiftExpected", { count: line.expected })}</span>
              {line.arrived === 0 && line.late === 0 ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Hourglass className="size-4" aria-hidden />
                  {t("dashboard.live.shiftNotStarted")}
                </span>
              ) : (
                <>
                  <span>{t("dashboard.live.shiftArrived", { count: line.arrived })}</span>
                  <span>{t("dashboard.live.shiftLate", { count: line.late })}</span>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlantNotice({ live, canSetStartDate }: { live: PlantLive; canSetStartDate: boolean }) {
  const { t } = useTranslation();
  // The server has no "employee count" here: all zeros on a started plant means nobody is set up.
  const nobody =
    live.expected + live.on_leave + live.off_today + live.inside_now + live.arrived === 0;
  if (!live.attendance_started) {
    return (
      <Alert tone="warning">
        <Info aria-hidden />
        <div>
          <p className="font-bold">{t("dashboard.live.notStarted")}</p>
          <p>{t("dashboard.live.notStartedText")}</p>
          {canSetStartDate ? (
            <Link to={`/admin/plants/${live.plant.id}`} className="font-semibold underline">
              {t("dashboard.live.setStartDate")}
            </Link>
          ) : null}
        </div>
      </Alert>
    );
  }
  if (nobody) {
    return (
      <Alert>
        <Info aria-hidden />
        <div>
          <p className="font-bold">{t("dashboard.live.noEmployees")}</p>
          <p>{t("dashboard.live.noEmployeesText")}</p>
          <Link to="/admin/employees" className="font-semibold underline">
            {t("dashboard.live.goEmployees")}
          </Link>
        </div>
      </Alert>
    );
  }
  return null;
}

const TABLE_COLUMNS = [
  ["inside_now", "insideNow"],
  ["expected", "expected"],
  ["arrived", "arrived"],
  ["late", "late"],
  ["not_arrived", "notArrived"],
  ["on_leave", "onLeave"],
  ["exceptions", "exceptions"],
] as const;

function PlantCardNumbers({ numbers }: { numbers: PlantNumbers }) {
  const { t } = useTranslation();
  return (
    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
      {TABLE_COLUMNS.map(([field, key]) => (
        <div key={field} className={cn(field === "inside_now" && "col-span-3")}>
          <dt className="text-muted-foreground">{t(`dashboard.live.table.${key}`)}</dt>
          <dd className={cn("tnum font-bold", field === "inside_now" && "text-3xl font-extrabold")}>
            {formatNumber(numbers[field])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Demo plants are listed but never part of the total (the server leaves them out of it).
function AllPlants({ plants, totals }: { plants: PlantLive[]; totals: PlantNumbers }) {
  const { t } = useTranslation();
  const { setPlantId } = usePlantFilter();
  const plantButton = (live: PlantLive) => (
    <button
      type="button"
      onClick={() => setPlantId(live.plant.id)}
      className="cursor-pointer font-bold text-primary underline"
    >
      {live.plant.code}
    </button>
  );
  const demoBadge = (live: PlantLive) =>
    live.plant.is_demo ? (
      <span className="ml-2 rounded-full border border-dashed border-warning px-2 py-0.5 text-xs font-bold text-warning">
        {t("dashboard.live.demoBadge")}
      </span>
    ) : null;
  const notStarted = (
    <span className="text-sm font-semibold text-muted-foreground">
      {t("dashboard.live.notStartedShort")}
    </span>
  );

  return (
    <>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("dashboard.live.allPlants")}</caption>
          <thead className="bg-muted text-left">
            <tr>
              <th scope="col" className="p-3">
                {t("dashboard.live.table.plant")}
              </th>
              {TABLE_COLUMNS.map(([, key]) => (
                <th key={key} scope="col" className="p-3 text-right">
                  {t(`dashboard.live.table.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {plants.map((live) => (
              <tr key={live.plant.id} className={cn(live.plant.is_demo && "bg-warning-soft/30")}>
                <th scope="row" className="p-3 text-left font-normal">
                  {plantButton(live)}
                  <span className="ml-2">{live.plant.name}</span>
                  {demoBadge(live)}
                </th>
                {live.attendance_started ? (
                  TABLE_COLUMNS.map(([field]) => (
                    <td
                      key={field}
                      className={cn(
                        "tnum p-3 text-right",
                        field === "inside_now" && "text-base font-extrabold",
                      )}
                    >
                      {formatNumber(live[field])}
                    </td>
                  ))
                ) : (
                  <td colSpan={TABLE_COLUMNS.length} className="p-3 text-right">
                    {notStarted}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-primary-soft font-bold">
              <th scope="row" className="p-3 text-left">
                {t("dashboard.live.table.total")}
              </th>
              {TABLE_COLUMNS.map(([field]) => (
                <td key={field} className="tnum p-3 text-right">
                  {formatNumber(totals[field])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </Card>

      <ul className="space-y-3 md:hidden" aria-label={t("dashboard.live.allPlants")}>
        <li className="rounded-xl border bg-primary-soft p-4">
          <p className="font-bold">{t("dashboard.live.table.total")}</p>
          <PlantCardNumbers numbers={totals} />
        </li>
        {plants.map((live) => (
          <li
            key={live.plant.id}
            className={cn("rounded-xl border bg-card p-4", live.plant.is_demo && "border-dashed")}
          >
            <p>
              {plantButton(live)} <span className="font-semibold">{live.plant.name}</span>
              {demoBadge(live)}
            </p>
            {live.attendance_started ? <PlantCardNumbers numbers={live} /> : notStarted}
          </li>
        ))}
      </ul>
    </>
  );
}

function LoadingTiles() {
  const placeholders = ["a", "b", "c", "d", "e", "f", "g"];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" aria-busy="true">
      <Skeleton className="col-span-2 h-40" />
      {placeholders.map((id) => (
        <Skeleton key={id} className="h-32" />
      ))}
    </div>
  );
}

export function LiveDashboard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useTranslation();
  const { plantId } = usePlantFilter();
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const live = useLiveDashboard({ plantId, includeDemo: showDemo });
  const data = live.data;
  const single = plantId ? data?.plants[0] : undefined;
  const refreshFailed = live.isError && data !== undefined;

  let body: ReactNode = null;
  if (!data) {
    body = live.isError ? (
      <Alert tone="danger">
        <TriangleAlert aria-hidden />
        <div>
          <p>{describeError(live.error, t)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => live.refetch()}>
            {t("dashboard.live.tryAgain")}
          </Button>
        </div>
      </Alert>
    ) : (
      <LoadingTiles />
    );
  } else if (plantId) {
    if (single) {
      body = (
        <div className="space-y-4">
          <PlantNotice live={single} canSetStartDate={isSuperAdmin} />
          <TileGrid numbers={single} plantId={plantId} />
          <div className="grid gap-3 lg:grid-cols-2">
            {single.inside_temporary > 0 ? <ContractorCard live={single} /> : null}
            {single.shifts.length > 0 ? <ShiftsCard live={single} /> : null}
          </div>
        </div>
      );
    }
  } else {
    body = <AllPlants plants={data.plants} totals={data.totals} />;
  }

  return (
    <section className="space-y-4" aria-label={t("dashboard.live.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {data ? (
            <p className="text-sm text-muted-foreground">
              {weekday(data.date)} {formatDate(`${data.date}T00:00:00Z`)}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            {refreshFailed ? (
              <TriangleAlert className="size-4 text-warning" aria-hidden />
            ) : (
              <span className="size-2.5 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
            )}
            {data ? (
              <>
                <span className="font-semibold">
                  {t("dashboard.live.updated", { time: formatTime(new Date(live.dataUpdatedAt)) })}
                </span>
                <span className="text-muted-foreground">{t("dashboard.live.refreshes")}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showDemo ? <DemoChip /> : null}
          {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
          <PlantPicker />
        </div>
      </div>
      {refreshFailed ? (
        <Alert tone="warning">
          <TriangleAlert aria-hidden />
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {t("dashboard.live.stale", {
                time: formatTime(new Date(live.errorUpdatedAt)),
                old: formatTime(new Date(live.dataUpdatedAt)),
              })}
            </span>
            <Button variant="outline" size="sm" onClick={() => live.refetch()}>
              {t("dashboard.live.tryAgain")}
            </Button>
          </div>
        </Alert>
      ) : null}
      {body}
    </section>
  );
}
