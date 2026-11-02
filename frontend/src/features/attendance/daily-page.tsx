// The attendance list (/admin/attendance, spec M5 §4.3, design gate B screen 1): one row for every
// person and day, worked out by the server from the punches. Filters, the dashboard's `?show=`
// tile link, "days to decide" banner, paging and the daily muster download. Rows open the day
// drawer. All three roles read; the server limits a Plant Head to their own plant.
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  FileSpreadsheet,
  Flag,
  Info,
  NotebookPen,
  Pencil,
  Scale,
  Search,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { PlantFilterSelect, usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { useContractors } from "@/features/contractors/use-contractors";
import { DemoChip, DemoSwitch } from "@/features/dashboard/dashboard-controls";
import { useDemoSwitch } from "@/features/dashboard/use-dashboard";
import { useNamedItems, useShifts } from "@/features/plants/use-plants";
import { addDays } from "@/lib/dates";
import { formatNumber, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addMinutesToClock, clockText } from "./attendance-format";
import { DayRows } from "./daily-rows";
import { DayDrawerHost } from "./day-drawer-host";
import { filtersForShow } from "./show-filters";
import { downloadDailyMuster, saveFile, useDaily, useUndecided } from "./use-attendance-admin";
import { useDayDrawer } from "./use-day-drawer";

const PAGE_SIZE = 50;
const STATUSES = [
  "present",
  "half_day",
  "short_hours",
  "absent",
  "incomplete",
  "leave",
  "weekly_off",
  "holiday",
  "open",
] as const;

// What the Status select shows for each value of the API's `status`.
function statusKey(status: string): string {
  return status === "open" ? "in_progress" : status;
}

function ChoiceSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  allLabel: string;
}) {
  return (
    <div className="block min-w-0 text-sm font-semibold">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

type Chosen = {
  type: string;
  departmentId: string;
  categoryId: string;
  contractorId: string;
  shiftId: string;
};

// Department, category and shift belong to one plant, so they appear only once a plant is chosen.
function PlantFilters({
  plantId,
  chosen,
  change,
}: {
  plantId: string;
  chosen: Chosen;
  change: (changes: Partial<Chosen>) => void;
}) {
  const { t } = useTranslation();
  const departments = useNamedItems(plantId, "departments");
  const categories = useNamedItems(plantId, "categories");
  const shifts = useShifts(plantId);
  const all = t("attendance.filter.all");
  return (
    <>
      <ChoiceSelect
        label={t("attendance.filter.department")}
        value={chosen.departmentId}
        onChange={(departmentId) => change({ departmentId })}
        options={departments.data ?? []}
        allLabel={all}
      />
      <ChoiceSelect
        label={t("attendance.filter.category")}
        value={chosen.categoryId}
        onChange={(categoryId) => change({ categoryId })}
        options={categories.data ?? []}
        allLabel={all}
      />
      <ChoiceSelect
        label={t("attendance.filter.shift")}
        value={chosen.shiftId}
        onChange={(shiftId) => change({ shiftId })}
        options={shifts.data ?? []}
        allLabel={all}
      />
    </>
  );
}

function ToleranceLine({ plantId, shiftId }: { plantId: string; shiftId: string }) {
  const { t } = useTranslation();
  const shifts = useShifts(plantId);
  const shift = shifts.data?.find((entry) => entry.id === shiftId);
  if (!shift) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t("attendance.tolerance", {
        shift: shift.name,
        start: clockText(shift.start_time),
        end: clockText(shift.end_time),
        onTime: addMinutesToClock(shift.start_time, shift.grace_min),
        leave: clockText(shift.end_time),
      })}
    </p>
  );
}

function LoadingRows() {
  const rows = ["a", "b", "c", "d", "e", "f"];
  return (
    <div className="space-y-2 p-4" aria-busy="true">
      {rows.map((id) => (
        <Skeleton key={id} className="h-12" />
      ))}
    </div>
  );
}

export function DailyPage() {
  const { t } = useTranslation();
  const me = useMe();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { plantId, setPlantId, locked } = usePlantFilter();
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const { openDay } = useDayDrawer();
  const [params, setParams] = useSearchParams();

  // A dashboard tile link says which group of people it means: `show` and (optionally) a plant.
  const show = params.get("show");
  const fromTile = filtersForShow(show);
  const today = todayIst();
  const [date, setDate] = useState(params.get("date") ?? today);
  const [status, setStatus] = useState(fromTile?.status ?? "");
  const [exceptionsOnly, setExceptionsOnly] = useState(fromTile?.hasExceptions ?? false);
  const [correctedOnly, setCorrectedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [typedSearch, setTypedSearch] = useState("");
  const [chosen, setChosen] = useState<Chosen>({
    type: "",
    departmentId: "",
    categoryId: "",
    contractorId: "",
    shiftId: "",
  });
  const [page, setPage] = useState(1);
  const [fileError, setFileError] = useState<unknown>(null);
  const [filePending, setFilePending] = useState(false);

  // Take the plant of a tile link once, when the page opens.
  const linkedPlant = params.get("plant_id");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the link changes
  useEffect(() => {
    if (linkedPlant && !locked) setPlantId(linkedPlant);
  }, [linkedPlant]);

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTypedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Department, category and shift of another plant mean nothing here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the plant changes
  useEffect(() => {
    setChosen((now) => ({ ...now, departmentId: "", categoryId: "", shiftId: "" }));
    setPage(1);
  }, [plantId]);

  const change = (changes: Partial<Chosen>) => {
    setChosen((now) => ({ ...now, ...changes }));
    setPage(1);
  };

  const daily = useDaily({
    date,
    plant_id: plantId || undefined,
    status: status || undefined,
    type: chosen.type || undefined,
    department_id: chosen.departmentId || undefined,
    category_id: chosen.categoryId || undefined,
    contractor_id: chosen.contractorId || undefined,
    shift_id: chosen.shiftId || undefined,
    has_exceptions: exceptionsOnly || undefined,
    corrected: correctedOnly || undefined,
    q: typedSearch.trim() || undefined,
    include_demo: showDemo || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const undecided = useUndecided({
    from: `${today.slice(0, 8)}01`,
    to: today,
    plantId: plantId || undefined,
    includeDemo: showDemo,
  });
  const contractors = useContractors();

  const items = daily.data?.items ?? [];
  const total = daily.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const toDecide = (undecided.data?.short_hours ?? 0) + (undecided.data?.incomplete ?? 0);
  const filtered = Boolean(
    status ||
      exceptionsOnly ||
      correctedOnly ||
      typedSearch ||
      chosen.type ||
      chosen.departmentId ||
      chosen.categoryId ||
      chosen.contractorId ||
      chosen.shiftId ||
      show,
  );

  const clearFilters = () => {
    setStatus("");
    setExceptionsOnly(false);
    setCorrectedOnly(false);
    setSearch("");
    setTypedSearch("");
    setChosen({ type: "", departmentId: "", categoryId: "", contractorId: "", shiftId: "" });
    setPage(1);
    setParams((now) => {
      const next = new URLSearchParams(now);
      next.delete("show");
      return next;
    });
  };

  const moveDay = (days: number) => {
    setDate(addDays(date, days));
    setPage(1);
  };

  const download = async (file: "xlsx" | "pdf") => {
    setFilePending(true);
    setFileError(null);
    try {
      saveFile(
        await downloadDailyMuster(file, {
          date,
          plantId: plantId || undefined,
          includeDemo: showDemo,
        }),
        `daily-muster-${date}.${file}`,
      );
    } catch (failure) {
      setFileError(failure);
    } finally {
      setFilePending(false);
    }
  };

  const showDecided = () => {
    setStatus((undecided.data?.short_hours ?? 0) > 0 ? "short_hours" : "incomplete");
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("attendance.title")}</h1>
          <p className="text-muted-foreground">{t("attendance.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDemo ? <DemoChip /> : null}
          {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
          <Link to="/admin/attendance/register" className={buttonVariants({ variant: "outline" })}>
            <CalendarDays aria-hidden />
            {t("attendance.toolsRegister")}
          </Link>
          <Button variant="outline" disabled={filePending} onClick={() => download("xlsx")}>
            <FileSpreadsheet aria-hidden />
            {t("attendance.downloadMuster")} · {t("attendance.excel")}
          </Button>
          <Button variant="outline" disabled={filePending} onClick={() => download("pdf")}>
            <FileDown aria-hidden />
            {t("attendance.downloadMuster")} · {t("attendance.pdf")}
          </Button>
        </div>
      </header>

      {fileError ? (
        <Alert tone="danger">
          <TriangleAlert aria-hidden />
          {describeError(fileError, t)}
        </Alert>
      ) : null}

      {toDecide > 0 ? (
        <Alert tone="warning" className="items-center border-[#f0c9a8] bg-[#ffe9d6] text-[#8a3a00]">
          <Scale aria-hidden />
          <div className="flex-1">
            <p className="font-bold">{t("attendance.decideBanner.title", { count: toDecide })}</p>
            <p>{t("attendance.decideBanner.text")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={showDecided}>
            {t("attendance.decideBanner.show")}
          </Button>
        </Alert>
      ) : null}

      {show && fromTile ? (
        <Alert tone="info">
          <Info aria-hidden />
          <span>
            {t("attendance.show.from", { tile: t(`attendance.show.${show}`) })}
            {fromTile.exact ? "" : ` ${t("attendance.show.closest")}`}
          </span>
        </Alert>
      ) : null}

      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">{t("attendance.filter.date")}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.filter.previousDay")}
                onClick={() => moveDay(-1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Input
                type="date"
                value={date}
                max={today}
                aria-label={t("attendance.filter.date")}
                onChange={(event) => {
                  if (event.target.value) {
                    setDate(event.target.value);
                    setPage(1);
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("attendance.filter.nextDay")}
                disabled={date >= today}
                onClick={() => moveDay(1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
          <div className="min-w-0 text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">{t("attendance.filter.plant")}</span>
            <PlantFilterSelect />
          </div>
          <div className="block min-w-0 text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">
              {t("attendance.filter.status")}
            </span>
            <Select
              aria-label={t("attendance.filter.status")}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("attendance.filter.all")}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`attendance.status.${statusKey(value)}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="block min-w-0 text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">
              {t("attendance.filter.search")}
            </span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label={t("attendance.filter.search")}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="block min-w-0 text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">{t("attendance.filter.type")}</span>
            <Select
              aria-label={t("attendance.filter.type")}
              value={chosen.type}
              onChange={(event) => change({ type: event.target.value })}
            >
              <option value="">{t("attendance.filter.all")}</option>
              <option value="permanent">{t("attendance.type.permanent")}</option>
              <option value="temporary">{t("attendance.type.temporary")}</option>
            </Select>
          </div>
          {plantId ? <PlantFilters plantId={plantId} chosen={chosen} change={change} /> : null}
          <ChoiceSelect
            label={t("attendance.filter.contractor")}
            value={chosen.contractorId}
            onChange={(contractorId) => change({ contractorId })}
            options={contractors.data ?? []}
            allLabel={t("attendance.filter.all")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip
            label={t("attendance.filter.exceptions")}
            icon={TriangleAlert}
            active={exceptionsOnly}
            onClick={() => {
              setExceptionsOnly(!exceptionsOnly);
              setPage(1);
            }}
          />
          <ToggleChip
            label={t("attendance.filter.corrected")}
            icon={Pencil}
            active={correctedOnly}
            onClick={() => {
              setCorrectedOnly(!correctedOnly);
              setPage(1);
            }}
          />
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t("attendance.filter.clear")}
            </Button>
          ) : null}
        </div>
        {plantId && chosen.shiftId ? (
          <ToleranceLine plantId={plantId} shiftId={chosen.shiftId} />
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        {daily.isError && !daily.data ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <WifiOff className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-lg font-bold">{t("attendance.error.title")}</p>
            <p className="text-muted-foreground">
              {describeError(daily.error, t)} {t("attendance.error.text")}
            </p>
            <Button variant="outline" onClick={() => daily.refetch()}>
              {t("attendance.error.tryAgain")}
            </Button>
          </div>
        ) : null}
        {daily.isPending ? <LoadingRows /> : null}
        {daily.data && items.length === 0 ? (
          <div className="space-y-2 p-6">
            <p className="text-lg font-bold">{t("attendance.empty.title")}</p>
            <p className="text-muted-foreground">{t("attendance.empty.text")}</p>
            {filtered ? (
              <Button variant="outline" onClick={clearFilters}>
                {t("attendance.filter.clear")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {items.length > 0 ? <DayRows items={items} openDay={openDay} /> : null}
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
            <span>
              {t("attendance.showing", {
                shown: formatNumber(items.length),
                total: formatNumber(total),
              })}
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t("attendance.previous")}
              </Button>
              <span className="tnum">{t("attendance.pageOf", { page, pages: lastPage })}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setPage(page + 1)}
              >
                {t("attendance.next")}
              </Button>
            </span>
          </div>
        ) : null}
      </Card>

      {items.length > 0 ? <MarksLegend /> : null}
      <DayDrawerHost />
    </div>
  );
}

function ToggleChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Pencil;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border bg-card px-3 text-sm font-semibold hover:bg-muted",
        active &&
          "border-primary bg-primary-soft text-primary-soft-foreground ring-2 ring-primary/30",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function MarksLegend() {
  const { t } = useTranslation();
  const marks = [
    { icon: Pencil, text: t("attendance.mark.corrected") },
    { icon: Clock, text: t("attendance.mark.pending") },
    { icon: Flag, text: t("attendance.mark.flagged") },
    { icon: NotebookPen, text: t("attendance.mark.extra") },
    { icon: TriangleAlert, text: t("attendance.mark.exceptionsLegend") },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="font-semibold">{t("attendance.col.marks")}:</li>
      {marks.map(({ icon: Icon, text }) => (
        <li key={text} className="inline-flex items-center gap-1">
          <Icon className="size-3.5" aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}
