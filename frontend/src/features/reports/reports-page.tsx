// Reports (/admin/reports, spec M5 §4.11 and §5.5, design gate C screen 5): seven reports as
// Excel or PDF. Every card has its own period, plant and (for contractor hours) contractor. The
// server builds the file, checks the limits and writes the audit row; this page only asks, shows
// that it is busy and says in plain words why a file was refused.
import {
  ClipboardList,
  FileDown,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  Gauge,
  HardHat,
  Info,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
  ShieldX,
  Table2,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { useContractors } from "@/features/contractors/use-contractors";
import { DemoSwitch } from "@/features/dashboard/dashboard-controls";
import { useDemoSwitch } from "@/features/dashboard/use-dashboard";
import { usePlants } from "@/features/plants/use-plants";
import { ApiError } from "@/lib/api-client";
import { todayIst } from "@/lib/format";
import {
  daysBetween,
  downloadReport,
  MAX_RANGE_DAYS,
  REPORTS,
  type ReportChoice,
  type ReportConfig,
  type ReportFormat,
  type ReportKind,
} from "./use-reports";

const KIND_ICONS: Record<ReportKind, ComponentType<{ className?: string }>> = {
  "daily-muster": ClipboardList,
  register: Table2,
  "contractor-hours": HardHat,
  "late-early-overtime": Timer,
  exceptions: TriangleAlert,
  "rejected-punches": ShieldX,
  corrections: FilePenLine,
};

function addDays(isoDate: string, days: number): string {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/** The last 12 months, newest first: { value: "2026-10", label: "October 2026" }. */
function recentMonths(today: string): { value: string; label: string }[] {
  const [year = 0, month = 1] = today.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return Array.from({ length: 12 }, (_, back) => {
    const moment = new Date(Date.UTC(year, month - 1 - back, 1));
    return { value: moment.toISOString().slice(0, 7), label: formatter.format(moment) };
  });
}

type CardMessage = { tone: "error" | "done"; text: string; amber?: boolean } | null;

function messageClasses(message: NonNullable<CardMessage>): string {
  const base = "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] font-medium";
  if (message.tone === "done") return `${base} border-success/30 bg-success-soft text-success`;
  // Busy and rate limit are "wait a little": dashed amber, not the red of a real refusal.
  if (message.amber) return `${base} border-dashed border-warning bg-warning-soft text-warning`;
  return `${base} border-destructive/30 bg-destructive-soft text-destructive`;
}

type CardProps = {
  config: ReportConfig;
  plantLocked: boolean;
  lockedPlantId: string;
  includeDemo: boolean;
  /** Something is being built now: every button waits. */
  anyBusy: boolean;
  onBusy: (busy: boolean) => void;
};

function ReportCard({
  config,
  plantLocked,
  lockedPlantId,
  includeDemo,
  anyBusy,
  onBusy,
}: CardProps) {
  const { t } = useTranslation();
  const plants = usePlants({ is_active: true });
  const contractors = useContractors();
  const today = todayIst();
  const months = recentMonths(today);
  const [choice, setChoice] = useState<ReportChoice>({
    day: addDays(today, -1),
    month: months[0]?.value ?? "",
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    plantId: "",
    contractorId: "",
    includeDemo: false,
  });
  const [message, setMessage] = useState<CardMessage>(null);
  const [building, setBuilding] = useState<ReportFormat | null>(null);
  const Icon = KIND_ICONS[config.kind];
  const id = `report-${config.kind}`;
  // The plant of a Plant Head and the demo switch come from the page, not from this card.
  const effective: ReportChoice = {
    ...choice,
    includeDemo,
    plantId: plantLocked ? lockedPlantId : choice.plantId,
  };

  const days = daysBetween(choice.dateFrom, choice.dateTo);
  const rangeTooLong = config.period === "range" && days > MAX_RANGE_DAYS;
  const rangeBackwards = config.period === "range" && days < 1;
  const noPeriod =
    (config.period === "day" && !choice.day) ||
    (config.period === "range" && (!choice.dateFrom || !choice.dateTo));
  const fieldError = rangeTooLong
    ? t("reports.error.range", { days })
    : rangeBackwards
      ? t("reports.error.order")
      : undefined;
  const cannotAsk = Boolean(fieldError) || noPeriod || anyBusy;

  const set = (changes: Partial<ReportChoice>) =>
    setChoice((current) => ({ ...current, ...changes }));

  const ask = async (format: ReportFormat) => {
    setMessage(null);
    setBuilding(format);
    onBusy(true);
    try {
      const { fileName } = await downloadReport(config, format, effective);
      setMessage({ tone: "done", text: t("reports.done", { file: fileName }) });
      toast.success(t("reports.toast"));
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "";
      // The 20-in-10-minutes limit has its own wording here; other codes use errors.<CODE>.
      setMessage({
        tone: "error",
        text:
          code === "TOO_MANY_REQUESTS" ? t("reports.error.rateLimit") : describeError(failure, t),
        amber: code === "TOO_MANY_REQUESTS" || code === "REPORT_BUSY",
      });
    } finally {
      setBuilding(null);
      onBusy(false);
    }
  };

  const plantOptions = plants.data?.items ?? [];
  const ownPlant = plantOptions.find((plant) => plant.id === lockedPlantId);

  return (
    <Card className="flex flex-col" aria-labelledby={`${id}-title`}>
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id={`${id}-title`} className="text-base font-bold">
              {t(`reports.kind.${config.kind}.title`)}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`reports.kind.${config.kind}.body`)}</p>
          </div>
        </div>

        {config.period === "day" ? (
          <Field id={`${id}-day`} label={t("reports.field.day")}>
            <Input
              id={`${id}-day`}
              type="date"
              value={choice.day}
              max={today}
              onChange={(event) => set({ day: event.target.value })}
            />
          </Field>
        ) : null}
        {config.period === "month" ? (
          <Field id={`${id}-month`} label={t("reports.field.month")}>
            <Select
              id={`${id}-month`}
              value={choice.month}
              onChange={(event) => set({ month: event.target.value })}
            >
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {config.period === "range" ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${id}-from`} label={t("reports.field.from")}>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={choice.dateFrom}
                  max={today}
                  aria-invalid={Boolean(fieldError)}
                  onChange={(event) => set({ dateFrom: event.target.value })}
                />
              </Field>
              <Field id={`${id}-to`} label={t("reports.field.to")}>
                <Input
                  id={`${id}-to`}
                  type="date"
                  value={choice.dateTo}
                  max={today}
                  aria-invalid={Boolean(fieldError)}
                  onChange={(event) => set({ dateTo: event.target.value })}
                />
              </Field>
            </div>
            {fieldError ? (
              <p role="alert" className="mt-1 text-[13px] font-medium text-destructive">
                {fieldError}
              </p>
            ) : null}
          </div>
        ) : null}

        <Field id={`${id}-plant`} label={t("reports.field.plant")}>
          {plantLocked ? (
            <span className="flex h-11 items-center gap-2 rounded-md border bg-muted px-3 text-sm font-semibold">
              <Lock className="size-4" aria-hidden />
              {ownPlant ? `${ownPlant.code} · ${ownPlant.name}` : t("reports.yourPlant")}
            </span>
          ) : (
            <Select
              id={`${id}-plant`}
              value={choice.plantId}
              onChange={(event) => set({ plantId: event.target.value })}
            >
              <option value="">{t("plantFilter.all")}</option>
              {plantOptions.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.code} · {plant.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {config.hasContractor ? (
          <Field id={`${id}-contractor`} label={t("reports.field.contractor")}>
            <Select
              id={`${id}-contractor`}
              value={choice.contractorId}
              onChange={(event) => set({ contractorId: event.target.value })}
            >
              <option value="">{t("reports.allContractors")}</option>
              {(contractors.data ?? []).map((contractor) => (
                <option key={contractor.id} value={contractor.id}>
                  {contractor.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="space-y-3 border-t bg-muted/30 p-4 sm:px-5">
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={messageClasses(message)}
          >
            {message.tone === "done" ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span className="break-words">{message.text}</span>
          </p>
        ) : null}
        {building ? (
          <p role="status" className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
            {t("reports.buildingNote")}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-11 border-success/50 text-success"
            disabled={cannotAsk}
            onClick={() => ask("xlsx")}
          >
            {building === "xlsx" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet aria-hidden />
            )}
            {building === "xlsx" ? t("reports.building") : t("reports.excel")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={cannotAsk}
            onClick={() => ask("pdf")}
          >
            {building === "pdf" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FileText aria-hidden />
            )}
            {building === "pdf" ? t("reports.building") : t("reports.pdf")}
          </Button>
        </div>
        <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t(`reports.kind.${config.kind}.limit`)} {t("reports.excelAllPdfLimited")}
          </span>
        </p>
      </div>
    </Card>
  );
}

const LIMITS = [
  { key: "oneAtATime", icon: Layers },
  { key: "rate", icon: Gauge },
  { key: "pdfRows", icon: FileDown },
] as const;

export function ReportsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const plants = usePlants({ is_active: true });
  const isSuperAdmin = me.data?.role === "super_admin";
  const plantLocked = me.data?.role === "plant_head";
  const { showDemo, setShowDemo } = useDemoSwitch(isSuperAdmin);
  const [anyBusy, setAnyBusy] = useState(false);

  if (me.isPending || plants.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (plants.isError) {
    return (
      <Alert tone="danger" className="mx-auto max-w-6xl">
        <span>
          <strong>{t("reports.error.load")}.</strong> {describeError(plants.error, t)}
        </span>
        <Button variant="outline" size="sm" onClick={() => plants.refetch()}>
          {t("dashboard.live.tryAgain")}
        </Button>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("reports.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("reports.subtitle")}</p>
        </div>
        {isSuperAdmin ? <DemoSwitch on={showDemo} onChange={setShowDemo} /> : null}
      </div>

      <ul className="grid gap-3 md:grid-cols-3">
        {LIMITS.map(({ key, icon: LimitIcon }) => (
          <li key={key} className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
            <LimitIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span>
              <b className="block">{t(`reports.limit.${key}.title`)}</b>
              <span className="text-muted-foreground">{t(`reports.limit.${key}.body`)}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        {REPORTS.map((config) => (
          <ReportCard
            key={config.kind}
            config={config}
            plantLocked={plantLocked}
            lockedPlantId={me.data?.plant_ids[0] ?? ""}
            includeDemo={showDemo}
            anyBusy={anyBusy}
            onBusy={setAnyBusy}
          />
        ))}
      </div>

      <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("reports.footer")}
      </p>
    </div>
  );
}
