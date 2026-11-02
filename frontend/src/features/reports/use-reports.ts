// What the reports page needs: the seven kinds with the period each one takes, the address of one
// download, and the saving of the file under the name the server chose (spec M5 §5.5).
import { apiFile } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export type ReportKind =
  | "daily-muster"
  | "register"
  | "contractor-hours"
  | "late-early-overtime"
  | "exceptions"
  | "rejected-punches"
  | "corrections";

export type PeriodKind = "day" | "month" | "range";

export type ReportConfig = {
  kind: ReportKind;
  period: PeriodKind;
  hasContractor: boolean;
};

export const REPORTS: ReportConfig[] = [
  { kind: "daily-muster", period: "day", hasContractor: false },
  { kind: "register", period: "month", hasContractor: false },
  { kind: "contractor-hours", period: "month", hasContractor: true },
  { kind: "late-early-overtime", period: "range", hasContractor: false },
  { kind: "exceptions", period: "range", hasContractor: false },
  { kind: "rejected-punches", period: "range", hasContractor: false },
  { kind: "corrections", period: "range", hasContractor: false },
];

export const MAX_RANGE_DAYS = 31;

export type ReportChoice = {
  day: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  plantId: string;
  contractorId: string;
  includeDemo: boolean;
};

export type ReportFormat = "xlsx" | "pdf";

/** The number of days from `from` to `to`, both included (dates as "2026-10-31"). */
export function daysBetween(from: string, to: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(to) - Date.parse(from)) / millisecondsPerDay) + 1;
}

export function reportAddress(
  config: ReportConfig,
  format: ReportFormat,
  choice: ReportChoice,
): string {
  const period =
    config.period === "day"
      ? { date: choice.day }
      : config.period === "month"
        ? { month: choice.month }
        : { date_from: choice.dateFrom, date_to: choice.dateTo };
  return `/reports/${config.kind}.${format}${queryString({
    ...period,
    plant_id: choice.plantId || undefined,
    contractor_id: config.hasContractor ? choice.contractorId || undefined : undefined,
    include_demo: choice.includeDemo || undefined,
  })}`;
}

function saveFile(file: Blob, name: string) {
  const address = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

/** Builds one file on the server and saves it. Returns the saved file name and its size. */
export async function downloadReport(
  config: ReportConfig,
  format: ReportFormat,
  choice: ReportChoice,
): Promise<{ fileName: string }> {
  const { blob, fileName } = await apiFile(reportAddress(config, format, choice));
  const name = fileName ?? `upasthiti-${config.kind}.${format}`;
  saveFile(blob, name);
  return { fileName: name };
}
