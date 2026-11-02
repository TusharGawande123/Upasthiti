// Emergency muster (/admin/muster, spec M5 §4.2 and §7 rule 17, design gate A): everyone whose last
// punch is IN, for roll call at the assembly point. Works without a connection (it keeps the last
// list it loaded) and prints on A4 with a tick box column. The PDF comes from the server.
import {
  ChevronDown,
  ChevronsDown,
  CircleCheck,
  Clock,
  FileDown,
  IdCard,
  Info,
  LogIn,
  Printer,
  Search,
  Siren,
  Timer,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { formatDate, formatNumber, formatTime, formatTimeWithSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DemoChip, DemoSwitch, PlantPicker } from "./dashboard-controls";
import {
  downloadMusterPdf,
  type MusterPerson,
  type MusterResponse,
  useDemoSwitch,
  useMuster,
} from "./use-dashboard";

const STEP = 50;

type PlantBlock = MusterResponse["plants"][number];

function matches(person: MusterPerson, query: string): boolean {
  const { employee } = person;
  const text = [employee.code, employee.name, employee.department, employee.contractor]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

function TypeBadge({ type }: { type: MusterPerson["employee"]["type"] }) {
  const { t } = useTranslation();
  const Icon = type === "permanent" ? IdCard : Timer;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold",
        type === "permanent"
          ? "border-primary/25 bg-primary-soft text-primary-soft-foreground"
          : "border-warning/40 bg-warning-soft text-warning",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`muster.type.${type}`)}
    </span>
  );
}

const COLUMNS = [
  "code",
  "name",
  "type",
  "category",
  "department",
  "contractor",
  "inTime",
  "device",
] as const;

// One table from 768 px, one card per person below that.
function PersonTable({ people }: { people: MusterPerson[] }) {
  const { t } = useTranslation();
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="p-3">
                {t(`muster.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {people.map(({ employee, in_time, kiosk }) => (
            <tr key={employee.id}>
              <td className="p-3 font-mono font-semibold">{employee.code}</td>
              <td className="p-3 font-bold">{employee.name}</td>
              <td className="p-3">
                <TypeBadge type={employee.type} />
              </td>
              <td className="p-3">{employee.category ?? "–"}</td>
              <td className="p-3">{employee.department ?? "–"}</td>
              <td className="p-3">{employee.contractor ?? "–"}</td>
              <td className="tnum p-3 font-bold">
                <LogIn className="mr-1 inline size-4 text-success" aria-hidden />
                {formatTime(in_time)}
              </td>
              <td className="p-3">{kiosk?.name ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonCards({ people }: { people: MusterPerson[] }) {
  return (
    <ul className="divide-y md:hidden">
      {people.map(({ employee, in_time, kiosk }) => (
        <li key={employee.id} className="space-y-1 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-bold">{employee.name}</span>
            <span className="tnum font-bold">
              <LogIn className="mr-1 inline size-4 text-success" aria-hidden />
              {formatTime(in_time)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold">{employee.code}</span>
            <TypeBadge type={employee.type} />
            <span>{[employee.category, employee.department].filter(Boolean).join(" · ")}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {[employee.contractor, kiosk?.name].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

// The list on the screen is shown in steps; Print and PDF always include everyone.
function PeopleList({ people, total }: { people: MusterPerson[]; total: number }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(STEP);
  const shown = people.slice(0, limit);
  return (
    <div className="print:hidden">
      <PersonTable people={shown} />
      <PersonCards people={shown} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
        <span>{t("muster.showing", { shown: shown.length, total })}</span>
        {people.length > limit ? (
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => setLimit(limit + STEP)}>
              <ChevronsDown className="size-4" aria-hidden />
              {t("muster.showMore", { count: Math.min(STEP, people.length - limit) })}
            </Button>
            {people.length - limit > STEP ? (
              <Button variant="outline" onClick={() => setLimit(people.length)}>
                {t("muster.showAll", { count: people.length })}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// What is printed: A4, black and white, department heading rows, a tick box per person.
function PrintSheet({
  blocks,
  generatedAt,
  printedBy,
}: {
  blocks: PlantBlock[];
  generatedAt: string;
  printedBy: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="hidden print:block">
      {blocks.map((block) => {
        const departments = [...new Set(block.people.map((p) => p.employee.department ?? ""))];
        return (
          <section key={block.plant.id} className="mb-8 break-after-page text-black">
            <h2 className="text-2xl font-bold">
              {t("muster.title")} · {block.plant.code} {block.plant.name}
            </h2>
            <p>
              {t("muster.listTime", { time: formatTimeWithSeconds(generatedAt) })} ·{" "}
              {formatDate(generatedAt)}
            </p>
            <p className="text-5xl font-extrabold">{t("muster.count", { count: block.count })}</p>
            <p className="my-3 border-y py-2">{t("muster.sheet.rollCall")}</p>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="w-10 p-1">{t("muster.sheet.tick")}</th>
                  <th className="p-1">{t("muster.columns.code")}</th>
                  <th className="p-1">{t("muster.columns.name")}</th>
                  <th className="p-1">{t("muster.columns.type")}</th>
                  <th className="p-1">{t("muster.columns.contractor")}</th>
                  <th className="p-1">{t("muster.columns.inTime")}</th>
                </tr>
              </thead>
              {departments.map((department) => {
                const people = block.people.filter(
                  (p) => (p.employee.department ?? "") === department,
                );
                return (
                  <tbody key={department} className="break-inside-auto">
                    <tr className="bg-neutral-200 font-bold">
                      <td colSpan={6} className="p-1">
                        {department || "–"} ({people.length})
                      </td>
                    </tr>
                    {people.map(({ employee, in_time }) => (
                      <tr key={employee.id} className="border-b break-inside-avoid">
                        <td className="p-1">
                          <span className="inline-block size-4 border border-black" />
                        </td>
                        <td className="p-1 font-mono">{employee.code}</td>
                        <td className="p-1 font-bold">{employee.name}</td>
                        <td className="p-1">{t(`muster.type.${employee.type}`)}</td>
                        <td className="p-1">{employee.contractor ?? "–"}</td>
                        <td className="p-1">{formatTime(in_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
            <p className="mt-4 text-xs">
              {t("muster.sheet.printedBy", {
                time: formatTimeWithSeconds(new Date().toISOString()),
                name: printedBy,
              })}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function saveFile(file: Blob, name: string) {
  const address = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

function LoadingRows() {
  const rows = ["a", "b", "c", "d", "e"];
  return (
    <div className="space-y-2 p-3" aria-busy="true">
      {rows.map((id) => (
        <Skeleton key={id} className="h-10" />
      ))}
    </div>
  );
}

export function MusterPage() {
  const { t } = useTranslation();
  const me = useMe();
  const { plantId } = usePlantFilter();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const scope = { plantId, includeDemo: showDemo };
  const muster = useMuster(scope);
  const [query, setQuery] = useState("");
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<unknown>(null);

  const data = muster.data;
  // A failed refresh with an old list means "no connection": the saved list stays on the screen.
  const offline = muster.isError && data !== undefined;
  const total = data?.plants.reduce((sum, block) => sum + block.count, 0) ?? 0;
  const searching = query.trim() !== "";
  const blocks = (data?.plants ?? []).map((block) => ({
    ...block,
    found: searching ? block.people.filter((p) => matches(p, query)) : block.people,
  }));
  const found = blocks.reduce((sum, block) => sum + block.found.length, 0);

  const downloadPdf = async () => {
    setPdfPending(true);
    setPdfError(null);
    try {
      const code = data?.plants.length === 1 ? data.plants[0]?.plant.code : "all-plants";
      saveFile(await downloadMusterPdf(scope), `muster-${code}.pdf`);
    } catch (failure) {
      setPdfError(failure);
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="flex items-center gap-3 text-[26px] font-bold tracking-tight">
          <span className="grid size-11 place-items-center rounded-full bg-destructive-soft text-destructive">
            <Siren className="size-6" aria-hidden />
          </span>
          {t("muster.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {showDemo ? <DemoChip /> : null}
          {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
          <PlantPicker />
        </div>
      </div>

      <Alert className="print:hidden">
        <Info aria-hidden />
        {t("muster.note")}
      </Alert>

      {offline ? (
        <Alert tone="danger" className="border-2 print:hidden">
          <WifiOff aria-hidden />
          {t("muster.offline", { time: formatTimeWithSeconds(data.generated_at) })}
        </Alert>
      ) : null}
      {muster.isError && !data ? (
        <Alert tone="danger" className="print:hidden">
          {describeError(muster.error, t)}
          <Button variant="outline" size="sm" onClick={() => muster.refetch()}>
            {t("dashboard.live.tryAgain")}
          </Button>
        </Alert>
      ) : null}
      {pdfError ? (
        <Alert tone="danger" className="print:hidden">
          {describeError(pdfError, t)}
        </Alert>
      ) : null}

      <Card className="space-y-4 p-4 print:hidden">
        <div aria-live="polite">
          {data ? (
            <>
              <p className="flex flex-wrap items-baseline gap-3">
                <span className="tnum text-7xl leading-none font-extrabold">
                  {formatNumber(total)}
                </span>
                <span className="text-xl font-bold">
                  {t("muster.count", { count: total }).replace(/^\d[\d,]*\s/, "")}
                </span>
              </p>
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4" aria-hidden />
                {offline
                  ? t("muster.listTimeSaved", { time: formatTimeWithSeconds(data.generated_at) })
                  : t("muster.listTime", { time: formatTimeWithSeconds(data.generated_at) })}
                <span className="font-normal text-muted-foreground">
                  {formatDate(data.generated_at)}
                </span>
              </p>
            </>
          ) : (
            <Skeleton className="h-20 w-64" />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" className="h-16 text-base" onClick={() => window.print()}>
            <Printer className="size-5" aria-hidden />
            {t("muster.print")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className={cn("h-16 text-base", offline && "border-dashed")}
            disabled={!data || offline || pdfPending}
            onClick={downloadPdf}
          >
            <FileDown className="size-5" aria-hidden />
            {t("muster.downloadPdf")}
          </Button>
        </div>
        {offline ? (
          <p className="text-sm text-muted-foreground">{t("muster.pdfNeedsConnection")}</p>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("muster.search")}
            aria-label={t("muster.search")}
            className="h-13 pl-9"
          />
        </div>
        {data && searching ? (
          <span className="text-sm text-muted-foreground" role="status">
            {t("muster.matches", { count: found, total, query: query.trim() })}
          </span>
        ) : null}
      </div>

      {!data && !muster.isError ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : null}
      {data && total === 0 ? (
        <Card className="flex items-start gap-3 p-6 print:hidden">
          <CircleCheck className="size-6 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-lg font-bold">{t("muster.empty")}</p>
            <p className="text-muted-foreground">{t("muster.emptyText")}</p>
          </div>
        </Card>
      ) : null}
      {data && total > 0 ? (
        <div className="space-y-3">
          {blocks.map((block) =>
            data.plants.length === 1 ? (
              <Card key={block.plant.id} className="overflow-hidden">
                <PeopleList people={block.found} total={block.count} />
              </Card>
            ) : (
              // All plants: one block per plant that can be folded away.
              <Card key={block.plant.id} className="overflow-hidden print:hidden">
                <details open={block.count > 0}>
                  <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 p-3 font-bold">
                    <span>
                      {block.plant.code} · {block.plant.name}
                    </span>
                    <span className="flex items-center gap-2">
                      {t("muster.count", { count: block.count })}
                      <ChevronDown className="size-4" aria-hidden />
                    </span>
                  </summary>
                  <PeopleList people={block.found} total={block.count} />
                </details>
              </Card>
            ),
          )}
        </div>
      ) : null}

      {data ? (
        <PrintSheet
          blocks={data.plants}
          generatedAt={data.generated_at}
          printedBy={me.data?.name ?? ""}
        />
      ) : null}
    </div>
  );
}
