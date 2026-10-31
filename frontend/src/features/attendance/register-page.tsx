// The monthly register (/admin/attendance/register, spec M5 §4.4, design gate B screen 2): one
// cell for every person and day with its register code AND colour, then the month totals. One
// plant at a time (the server needs it). The grid scrolls inside its own card with the name
// column fixed; on a phone each person is a row that opens a month card instead of the grid.
import {
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  Search,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlantFilterSelect, usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { DemoChip, DemoSwitch } from "@/features/dashboard/dashboard-controls";
import { useDemoSwitch } from "@/features/dashboard/use-dashboard";
import { usePlants } from "@/features/plants/use-plants";
import { formatNumber, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDuration } from "./attendance-format";
import { DayDrawerHost } from "./day-drawer-host";
import { FAMILY_COLOURS, familyOfCode } from "./status-chip";
import {
  downloadRegister,
  type RegisterCell,
  type RegisterRow,
  saveFile,
  type Totals,
  useRegister,
} from "./use-attendance-admin";
import { useDayDrawer } from "./use-day-drawer";

const PAGE_SIZE = 100;
const DASH = "–";
const LEGEND_CODES = ["P", "HD", "SH", "A", "INC", "PL", "UL", "WO", "H", "WO-W", "H-W"] as const;

/** The twelve month totals, in the order of the register file. */
function totalColumns(totals: Totals, t: (key: string) => string) {
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

/** One day: its code on its colour; a black dot when the day was corrected. */
function DayCell({
  cell,
  row,
  small,
  onOpen,
}: {
  cell: RegisterCell;
  row: RegisterRow;
  small?: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const day = Number(cell.date.slice(8));
  const family = familyOfCode(cell.code);
  if (family === "none") {
    return (
      <span
        role="img"
        aria-label={t("attendance.register.none")}
        className="grid h-10 w-10 place-items-center text-muted-foreground"
      >
        {DASH}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("attendance.register.cellLabel", {
        name: row.employee.name,
        day,
        code: cell.code,
        corrected: cell.is_corrected ? t("attendance.register.correctedWord") : "",
      })}
      className={cn(
        "relative grid cursor-pointer place-items-center rounded-md border border-transparent font-mono font-bold hover:ring-2 hover:ring-primary/40",
        small ? "h-9 w-full text-[11px]" : "h-10 w-10 text-[11px]",
        FAMILY_COLOURS[family],
      )}
    >
      {cell.code}
      {cell.is_corrected ? (
        <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-black" />
      ) : null}
    </button>
  );
}

function RegisterGrid({
  rows,
  daysInMonth,
  openDay,
}: {
  rows: RegisterRow[];
  daysInMonth: number;
  openDay: (employeeId: string, date: string) => void;
}) {
  const { t } = useTranslation();
  const dayNumbers = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const headings = rows[0] ? totalColumns(rows[0].totals, t) : [];
  return (
    <div className="hidden md:block">
      <div className="max-h-[70vh] overflow-auto">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-52 border-b bg-muted p-2 text-left">
                {t("attendance.col.employee")}
              </th>
              {dayNumbers.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="tnum sticky top-0 z-20 min-w-10 border-b bg-muted px-1 py-2 text-center text-xs"
                >
                  {day}
                </th>
              ))}
              {headings.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="sticky top-0 z-20 min-w-24 border-b bg-muted p-2 text-center text-xs"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b bg-card p-2 text-left font-normal"
                >
                  <span className="block font-bold">{row.employee.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="font-mono font-semibold">{row.employee.code}</span>
                    {" · "}
                    {t(`attendance.type.${row.employee.type}`)}
                  </span>
                </th>
                {row.days.map((cell) => (
                  <td key={cell.date} className="border-b p-px text-center">
                    <DayCell
                      cell={cell}
                      row={row}
                      onOpen={() => openDay(row.employee.id, cell.date)}
                    />
                  </td>
                ))}
                {totalColumns(row.totals, t).map((column) => (
                  <td key={column.key} className="tnum border-b p-2 text-center font-semibold">
                    {column.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t p-3 text-xs text-muted-foreground">
        {t("attendance.register.scrollHint")}
      </p>
    </div>
  );
}

// Phone: a list of people; the opened one shows a month card of chips and its totals.
function RegisterCards({
  rows,
  openDay,
}: {
  rows: RegisterRow[];
  openDay: (employeeId: string, date: string) => void;
}) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="divide-y md:hidden">
      {rows.map((row) => {
        const isOpen = openId === row.employee.id;
        return (
          <li key={row.employee.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : row.employee.id)}
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 p-4 text-left"
            >
              <span className="min-w-0">
                <span className="block font-bold">{row.employee.name}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono font-semibold">{row.employee.code}</span>
                  {" · "}
                  {t(`attendance.type.${row.employee.type}`)}
                </span>
              </span>
              <ChevronDown
                className={cn("size-5 shrink-0 transition-transform", isOpen && "rotate-180")}
                aria-hidden
              />
            </button>
            {isOpen ? (
              <div className="space-y-3 px-4 pb-4">
                <div className="grid grid-cols-7 gap-1">
                  {row.days.map((cell) => (
                    <div key={cell.date} className="text-center">
                      <span className="tnum block text-[10px] text-muted-foreground">
                        {Number(cell.date.slice(8))}
                      </span>
                      <DayCell
                        cell={cell}
                        row={row}
                        small
                        onOpen={() => openDay(row.employee.id, cell.date)}
                      />
                    </div>
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {totalColumns(row.totals, t).map((column) => (
                    <div key={column.key} className="rounded-md bg-muted p-2">
                      <dt className="text-xs text-muted-foreground">{column.label}</dt>
                      <dd className="tnum font-bold">{column.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Legend() {
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

export function RegisterPage() {
  const { t } = useTranslation();
  const me = useMe();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { plantId: globalPlantId, locked } = usePlantFilter();
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const { openDay } = useDayDrawer();
  const plants = usePlants({ is_active: true });
  const thisMonth = todayIst().slice(0, 7);

  const [month, setMonth] = useState(thisMonth);
  const [pickedPlant, setPickedPlant] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fileError, setFileError] = useState<unknown>(null);
  const [filePending, setFilePending] = useState(false);

  // The register needs one plant: the one picked here, else the top-bar plant, else the first.
  const plantId = pickedPlant || globalPlantId || plants.data?.items[0]?.id || "";
  const register = useRegister(
    {
      month,
      plant_id: plantId,
      type: type || undefined,
      q: search.trim() || undefined,
      include_demo: showDemo || undefined,
      page,
      page_size: PAGE_SIZE,
    },
    plantId !== "",
  );

  const data = register.data;
  const rows = data?.items ?? [];
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const download = async (file: "xlsx" | "pdf") => {
    setFilePending(true);
    setFileError(null);
    try {
      saveFile(
        await downloadRegister(file, { month, plantId, includeDemo: showDemo }),
        `register-${month}.${file}`,
      );
    } catch (failure) {
      setFileError(failure);
    } finally {
      setFilePending(false);
    }
  };

  return (
    <div className="mx-auto max-w-[110rem] space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("attendance.register.title")}</h1>
          <p className="text-muted-foreground">{t("attendance.register.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDemo ? <DemoChip /> : null}
          {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
          <Button
            variant="outline"
            disabled={filePending || plantId === ""}
            onClick={() => download("xlsx")}
          >
            <FileSpreadsheet aria-hidden />
            {t("attendance.downloadExcel")}
          </Button>
          <Button
            variant="outline"
            disabled={filePending || plantId === ""}
            onClick={() => download("pdf")}
          >
            <FileDown aria-hidden />
            {t("attendance.downloadPdf")}
          </Button>
        </div>
      </header>

      {fileError ? (
        <Alert tone="danger">
          <TriangleAlert aria-hidden />
          {describeError(fileError, t)}
        </Alert>
      ) : null}

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">{t("attendance.register.month")}</span>
          <Input
            type="month"
            value={month}
            max={thisMonth}
            aria-label={t("attendance.register.month")}
            onChange={(event) => {
              if (event.target.value) {
                setMonth(event.target.value);
                setPage(1);
              }
            }}
          />
        </div>
        <div className="min-w-0 text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">{t("attendance.filter.plant")}</span>
          {locked ? (
            <PlantFilterSelect />
          ) : (
            <Select
              aria-label={t("attendance.filter.plant")}
              value={plantId}
              onChange={(event) => {
                setPickedPlant(event.target.value);
                setPage(1);
              }}
            >
              {(plants.data?.items ?? []).map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.code} · {plant.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="min-w-0 text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">{t("attendance.filter.type")}</span>
          <Select
            aria-label={t("attendance.filter.type")}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("attendance.filter.all")}</option>
            <option value="permanent">{t("attendance.type.permanent")}</option>
            <option value="temporary">{t("attendance.type.temporary")}</option>
          </Select>
        </div>
        <div className="min-w-0 text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">{t("attendance.filter.search")}</span>
          <span className="relative block">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              className="pl-9"
              aria-label={t("attendance.filter.search")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {register.isError && !data ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <WifiOff className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-lg font-bold">{t("attendance.error.title")}</p>
            <p className="text-muted-foreground">
              {describeError(register.error, t)} {t("attendance.error.text")}
            </p>
            <Button variant="outline" onClick={() => register.refetch()}>
              {t("attendance.error.tryAgain")}
            </Button>
          </div>
        ) : null}
        {register.isPending && plantId !== "" ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {["a", "b", "c", "d", "e"].map((id) => (
              <Skeleton key={id} className="h-12" />
            ))}
          </div>
        ) : null}
        {data && rows.length === 0 ? (
          <p className="p-6 text-lg font-bold">{t("attendance.register.empty")}</p>
        ) : null}
        {data && rows.length > 0 ? (
          <>
            <RegisterGrid rows={rows} daysInMonth={data.days_in_month} openDay={openDay} />
            <RegisterCards rows={rows} openDay={openDay} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
              <span>
                {t("attendance.showing", {
                  shown: formatNumber(rows.length),
                  total: formatNumber(data.total),
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
          </>
        ) : null}
      </Card>

      <Legend />
      <DayDrawerHost />
    </div>
  );
}
