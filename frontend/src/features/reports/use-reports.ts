// What the reports page needs: the seven kinds with the period each one takes, the address of one
// download, and the saving of the file under the name the server chose (spec M5 §5.5).
import { ApiError, apiFile } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export type ReportKind =
  | "daily-muster"
  | "register"
  | "contractor-hours"
  | "late-early-overtime"
  | "exceptions"
  | "rejected-punches"
  | "corrections"
  | "register-range"
  | "employee-range";

// "longRange" is a period of up to a year (M5c); "range" is up to 31 days.
export type PeriodKind = "day" | "month" | "range" | "longRange";

export type ReportConfig = {
  kind: ReportKind;
  period: PeriodKind;
  hasContractor: boolean;
  /** M5c: the register of a period needs one plant; one employee needs the employee. */
  needsPlant?: boolean;
  needsEmployee?: boolean;
};

export const REPORTS: ReportConfig[] = [
  { kind: "daily-muster", period: "day", hasContractor: false },
  { kind: "register", period: "month", hasContractor: false },
  { kind: "contractor-hours", period: "month", hasContractor: true },
  { kind: "late-early-overtime", period: "range", hasContractor: false },
  { kind: "exceptions", period: "range", hasContractor: false },
  { kind: "rejected-punches", period: "range", hasContractor: false },
  { kind: "corrections", period: "range", hasContractor: false },
  { kind: "register-range", period: "longRange", hasContractor: false, needsPlant: true },
  { kind: "employee-range", period: "longRange", hasContractor: false, needsEmployee: true },
];

export const MAX_RANGE_DAYS = 31;
export const MAX_LONG_RANGE_DAYS = 366;
/** While the days of a period are being calculated, the file is asked for again after this. */
export const PREPARING_RETRY_MS = 5000;
const MAX_PREPARING_TRIES = 60;

export type ReportChoice = {
  day: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  plantId: string;
  contractorId: string;
  employeeId: string;
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
    employee_id: config.needsEmployee ? choice.employeeId || undefined : undefined,
    contractor_id: config.hasContractor ? choice.contractorId || undefined : undefined,
    include_demo: choice.includeDemo || undefined,
  })}`;
}

/**
 * Asks for the file. While the server is still calculating the days (ATTENDANCE_PREPARING) it asks
 * again by itself every few seconds, so the person only waits (M5c).
 */
async function fileWhenReady(
  address: string,
  onPreparing?: () => void,
): Promise<{ blob: Blob; fileName: string | null }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await apiFile(address);
    } catch (failure) {
      const preparing = failure instanceof ApiError && failure.code === "ATTENDANCE_PREPARING";
      if (!preparing || attempt >= MAX_PREPARING_TRIES) throw failure;
      onPreparing?.();
      await new Promise((resolve) => setTimeout(resolve, PREPARING_RETRY_MS));
    }
  }
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
  onPreparing?: () => void,
): Promise<{ fileName: string }> {
  const { blob, fileName } = await fileWhenReady(
    reportAddress(config, format, choice),
    onPreparing,
  );
  const name = fileName ?? `upasthiti-${config.kind}.${format}`;
  saveFile(blob, name);
  return { fileName: name };
}
