// Server data for the attendance list, the monthly register and the corrections list (spec M5
// §5.1, §5.2). Field names follow backend/app/modules/attendance/schemas.py and
// backend/app/modules/regularisations/schemas.py. Every number here was worked out by the server.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiBlob, apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type Person = {
  id: string;
  code: string;
  name: string;
  type: "permanent" | "temporary";
  department: string | null;
  category: string | null;
  contractor: string | null;
};

export type Day = {
  date: string;
  plant: { id: string; code: string } | null;
  shift: { id: string; name: string } | null;
  employee_type: string;
  day_kind: string;
  // present, half_day, short_hours, absent, incomplete, leave, weekly_off, holiday, open ...
  status: string;
  // The register code: P, HD, SH, A, INC, PL, UL, WO, H, WO-W, H-W, IN, OUT, ... or a dash.
  code: string;
  // For a day that is still open: inside, left or not_arrived.
  open_state: "inside" | "left" | "not_arrived" | null;
  first_in: string | null;
  last_out: string | null;
  worked_min: number;
  payable_min: number;
  status_min: number | null;
  shift_length_min: number | null;
  extra_punch_count: number;
  late_min: number;
  early_exit_min: number;
  overtime_min: number;
  exceptions: string[];
  is_corrected: boolean;
  pending_corrections: number;
  uses_unchecked_flag: boolean;
};

export type DailyItem = { employee: Person; day: Day };

export type DailyFilters = {
  date: string;
  plant_id?: string;
  status?: string;
  type?: string;
  department_id?: string;
  category_id?: string;
  contractor_id?: string;
  shift_id?: string;
  has_exceptions?: boolean;
  corrected?: boolean;
  q?: string;
  include_demo?: boolean;
  page: number;
  page_size: number;
};

export type Totals = {
  present: number;
  half_day: number;
  short_hours: number;
  absent: number;
  incomplete: number;
  leave_paid: number;
  leave_unpaid: number;
  weekly_off: number;
  holiday: number;
  worked_on_off_day: number;
  worked_min: number;
  overtime_min: number;
  late_count: number;
  late_min: number;
  early_exit_count: number;
};

export type RegisterCell = {
  date: string;
  code: string;
  is_corrected: boolean;
  has_exceptions: boolean;
};

export type RegisterRow = { employee: Person; days: RegisterCell[]; totals: Totals };

export type RegisterResponse = {
  month: string;
  plant: { id: string; code: string; name: string };
  days_in_month: number;
  items: RegisterRow[];
  page: number;
  page_size: number;
  total: number;
};

// M5c: the register of any range (up to 93 days) and how many days are still being calculated.
export const RANGE_RETRY_MS = 5000;

export type RangeDay = { date: string; weekday: number };

export type RangeRegisterResponse = {
  date_from: string;
  date_to: string;
  plant: { id: string; code: string; name: string };
  days: RangeDay[];
  items: RegisterRow[];
  page: number;
  page_size: number;
  total: number;
  preparing: { pending_days: number };
};

// M5c: one employee, day by day, for up to 366 days.
export type EmployeeRange = {
  employee: Person;
  date_from: string;
  date_to: string;
  days: Day[];
  totals: Totals;
  totals_by_type: Record<string, Totals>;
  type_changes: { from_date: string; type: string }[];
  preparing: { pending_days: number };
};

export type RangeRegisterFilters = {
  date_from: string;
  date_to: string;
  plant_id: string;
  type?: string;
  q?: string;
  include_demo?: boolean;
  page: number;
  page_size: number;
};

export type RegisterFilters = {
  month: string;
  plant_id: string;
  type?: string;
  q?: string;
  include_demo?: boolean;
  page: number;
  page_size: number;
};

export type Undecided = {
  short_hours: number;
  incomplete: number;
  plants: {
    plant: { id: string; code: string; name: string };
    short_hours: number;
    incomplete: number;
  }[];
};

export type CorrectionState = "pending" | "approved" | "rejected" | "withdrawn" | "reversed";

export type Correction = {
  id: string;
  employee: { id: string; code: string; name: string };
  attendance_date: string;
  kind: "add_punch" | "add_in_out" | "ignore_punch" | "set_status";
  direction: "in" | "out" | null;
  in_time: string | null;
  out_time: string | null;
  status_value: "present" | "half_day" | "absent" | null;
  punch_id: string | null;
  reverses_id: string | null;
  reason: string;
  requested_by: { id: string; name: string };
  requested_at: string;
  is_direct: boolean;
  batch_id: string | null;
  state: CorrectionState;
  decision: {
    action: string;
    reason: string | null;
    decided_by: { id: string; name: string };
    decided_at: string;
  } | null;
};

export type CorrectionFilters = {
  state?: CorrectionState;
  mine?: boolean;
  plant_id?: string;
  page: number;
  page_size: number;
};

export type PunchApproval = {
  punch_id: string;
  punch_time: string;
  employee: { id: string; code: string; name: string } | null;
  action: string;
  direction: "in" | "out" | null;
  reviewed_by: { id: string; name: string };
  reviewed_at: string;
  // Only the Super Admin gets the reason.
  reason: string | null;
};

export const ATTENDANCE_KEY = ["attendance"] as const;
export const CORRECTIONS_KEY = ["corrections"] as const;

const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The list of one day. The server brings the day up to date on every read. */
export function useDaily(filters: DailyFilters) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "daily", filters],
    queryFn: () => apiGet<Page<DailyItem>>(`/attendance/daily${queryString({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** The register of one plant and month; `enabled` is false until a plant is chosen. */
export function useRegister(filters: RegisterFilters, enabled: boolean) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "register", filters],
    queryFn: () => apiGet<RegisterResponse>(`/attendance/register${queryString({ ...filters })}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

type Range = { from: string; to: string; plantId?: string; includeDemo?: boolean };

/** Short-hours and Incomplete days that still wait for a decision, from `from` to `to`. */
/** The range register. While days are still being calculated it asks again every 5 seconds. */
export function useRegisterRange(filters: RangeRegisterFilters, enabled: boolean) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "register-range", filters],
    queryFn: () =>
      apiGet<RangeRegisterResponse>(`/attendance/register-range${queryString({ ...filters })}`),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      (query.state.data?.preparing.pending_days ?? 0) > 0 ? RANGE_RETRY_MS : false,
  });
}

/** One employee over a range; asks again every 5 seconds while days are being calculated. */
export function useEmployeeRange(
  employeeId: string,
  range: { date_from: string; date_to: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "employee-range", employeeId, range],
    queryFn: () =>
      apiGet<EmployeeRange>(`/attendance/employee/${employeeId}/range${queryString({ ...range })}`),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      (query.state.data?.preparing.pending_days ?? 0) > 0 ? RANGE_RETRY_MS : false,
  });
}

export function useUndecided(range: Range) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "undecided", range],
    queryFn: () =>
      apiGet<Undecided>(
        `/attendance/undecided${queryString({
          date_from: range.from,
          date_to: range.to,
          plant_id: range.plantId,
          include_demo: range.includeDemo || undefined,
        })}`,
      ),
  });
}

export function useCorrections(filters: CorrectionFilters) {
  return useQuery({
    queryKey: [...CORRECTIONS_KEY, "list", filters],
    queryFn: () => apiGet<Page<Correction>>(`/regularisations${queryString({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** The number on the "Corrections" menu item: requests waiting for the Super Admin. */
export function useCorrectionSummary(enabled: boolean) {
  return useQuery({
    queryKey: [...CORRECTIONS_KEY, "summary"],
    queryFn: () => apiGet<{ pending: number; mine_pending: number }>("/regularisations/summary"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function usePunchApprovals(range: Range & { page: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...CORRECTIONS_KEY, "punch-approvals", range],
    queryFn: () =>
      apiGet<Page<PunchApproval>>(
        `/punch-approvals${queryString({
          date_from: range.from,
          date_to: range.to,
          plant_id: range.plantId,
          page: range.page,
          page_size: 50,
        })}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export type CorrectionAction = "approve" | "reject" | "withdraw" | "reverse";

/** Approve, reject, withdraw or reverse one correction. Reject and reverse need a reason. */
export function useCorrectionAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: CorrectionAction;
      reason?: string;
    }) =>
      apiPost<{ correction: Correction }>(
        `/regularisations/${id}/${action}`,
        action === "reject" || action === "reverse" ? { reason } : undefined,
      ),
    onSuccess: () => {
      // A decision changes the day results, so the lists and the register are read again.
      queryClient.invalidateQueries({ queryKey: CORRECTIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    },
  });
}

function reportFile(
  kind: string,
  file: "xlsx" | "pdf",
  filters: Record<string, string | boolean | undefined>,
): Promise<Blob> {
  return apiBlob(`/reports/${kind}.${file}${queryString(filters)}`, {
    method: "GET",
    accept: file === "xlsx" ? EXCEL : "application/pdf",
  });
}

/** The register as a file: the server builds it; this only fetches the bytes. */
export function downloadRegister(
  file: "xlsx" | "pdf",
  scope: { month: string; plantId: string; includeDemo?: boolean },
): Promise<Blob> {
  return reportFile("register", file, {
    month: scope.month,
    plant_id: scope.plantId,
    include_demo: scope.includeDemo || undefined,
  });
}

/** The register of a period (up to one year, one plant) as a file. */
export function downloadRegisterRange(
  file: "xlsx" | "pdf",
  scope: {
    dateFrom: string;
    dateTo: string;
    plantId: string;
    includeDemo?: boolean;
    type?: string;
  },
): Promise<Blob> {
  return reportFile("register-range", file, {
    date_from: scope.dateFrom,
    date_to: scope.dateTo,
    plant_id: scope.plantId,
    type: scope.type || undefined,
    include_demo: scope.includeDemo || undefined,
  });
}

/** One employee over a period as a file (the PDF is the print-friendly sheet, F-89). */
export function downloadEmployeeRange(
  file: "xlsx" | "pdf",
  scope: { employeeId: string; dateFrom: string; dateTo: string },
): Promise<Blob> {
  return reportFile("employee-range", file, {
    employee_id: scope.employeeId,
    date_from: scope.dateFrom,
    date_to: scope.dateTo,
  });
}

export function downloadDailyMuster(
  file: "xlsx" | "pdf",
  scope: { date: string; plantId?: string; includeDemo?: boolean },
): Promise<Blob> {
  return reportFile("daily-muster", file, {
    date: scope.date,
    plant_id: scope.plantId,
    include_demo: scope.includeDemo || undefined,
  });
}

/** Starts the browser's "save file" for bytes we already hold. */
export function saveFile(file: Blob, name: string) {
  const address = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}
