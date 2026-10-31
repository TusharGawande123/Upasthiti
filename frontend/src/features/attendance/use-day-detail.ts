// Server data and actions for the employee's Attendance tab, the day drawer, the correction dialog,
// the bulk correction wizard and the one-day shift swap (spec M5 §5.1, §5.2, §5.3). Field names
// follow backend/app/modules/attendance/detail_service.py, regularisations/schemas.py,
// regularisations/bulk_service.py and shift_swaps/schemas.py. Every number was worked out by the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  ATTENDANCE_KEY,
  CORRECTIONS_KEY,
  type Correction,
  type Day,
  type Person,
  type Totals,
} from "./use-attendance-admin";

export type LeaveLine = {
  id: string;
  from_date: string;
  to_date: string;
  is_paid: boolean;
  reason: string | null; // only the Super Admin gets the reason
  cancelled: boolean;
};

export type EmployeeMonth = {
  employee: Person;
  days: Day[];
  totals: Totals;
  leave: LeaveLine[];
  corrections: Correction[];
};

export type YearMonth = {
  month: string;
  days: { date: string; code: string; is_corrected: boolean }[];
};

export type Sentence = { key: string; values: Record<string, string | number | boolean> };

export type ShiftRules = {
  shift_id: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  shift_length_min: number;
  grace_min: number;
  half_day_min: number;
  overtime_min_minutes: number;
  effective_from: string | null;
};

export type TimelineItem =
  | {
      kind: "punch";
      punch_id: string;
      punch_time: string;
      direction: "in" | "out";
      decision: string;
      counts: boolean;
      role: "first_in" | "last_out" | "extra" | null;
      ignored_by_correction_id: string | null;
      kiosk: { id: string; name: string } | null;
      method: string;
      was_offline: boolean;
      carry_over: boolean;
    }
  | {
      kind: "review";
      punch_id: string;
      action: string;
      direction: "in" | "out" | null;
      reviewed_by: { id: string; name: string };
      reviewed_at: string;
      reason: string | null; // only the Super Admin gets the reason
    }
  | {
      kind: "correction";
      correction_id: string;
      correction_kind: Correction["kind"];
      direction: "in" | "out" | null;
      in_time: string | null;
      out_time: string | null;
      status_value: Correction["status_value"];
      punch_id: string | null;
      state: Correction["state"];
      reason: string;
      requested_by: string;
      requested_at: string;
      decided_by: string | null;
      decided_at: string | null;
      decision_reason: string | null;
    }
  | { kind: "leave"; leave_id: string; is_paid: boolean; reason: string | null }
  | { kind: "holiday"; holiday_id: string }
  | { kind: "weekly_off" };

export type CorrectionKind = Correction["kind"];

export type DayDetail = {
  day: Day;
  explanation: Sentence[];
  shift_swap: { id: string; shift: { id: string; name: string }; reason: string } | null;
  shift_rules: ShiftRules | null;
  window: { start: string; end: string } | null;
  timeline: TimelineItem[];
  allowed_correction_kinds: CorrectionKind[];
  can_request: boolean;
  can_correct: boolean;
};

export type SwapLine = {
  id: string;
  date: string;
  shift: { id: string; name: string };
  reason: string;
  created_by: string;
  created_at: string;
  cancelled: { by: string; at: string; reason: string | null } | null;
};

/** The body of a new correction (also used for the preview). Times are ISO with the IST offset. */
export type CorrectionBody = {
  employee_id: string;
  attendance_date: string;
  kind: CorrectionKind;
  direction?: "in" | "out";
  in_time?: string;
  out_time?: string;
  punch_id?: string;
  status_value?: "present" | "half_day" | "absent";
  reason: string;
};

export type PreviewAnswer = { before: Day; after: Day; warnings: { code: string }[] };

export type BulkBody = {
  plant_id: string;
  attendance_date: string;
  kind: "add_punch" | "add_in_out";
  direction?: "in" | "out";
  in_time?: string;
  out_time?: string;
  employee_ids: string[];
  reason: string;
};

export type BulkPreviewItem = {
  employee: { id: string; code: string; name: string };
  before: Day | null;
  after: Day | null;
  skip_code: string | null;
};

export type BulkPreviewAnswer = {
  items: BulkPreviewItem[];
  will_create: number;
  will_skip: number;
};
export type BulkCreated = {
  batch_id: string;
  created: number;
  skipped: { employee_id: string; code: string }[];
};

/** "2026-10-29" + "17:00" typed in IST -> "2026-10-29T17:00:00+05:30" (the server wants a zone). */
export function istToIso(date: string, time: string): string {
  return `${date}T${time.length === 5 ? `${time}:00` : time}+05:30`;
}

export function useEmployeeMonth(employeeId: string, month: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "employee", employeeId, month],
    queryFn: () => apiGet<EmployeeMonth>(`/attendance/employee/${employeeId}?month=${month}`),
  });
}

export function useEmployeeYear(employeeId: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "year", employeeId],
    queryFn: () => apiGet<{ months: YearMonth[] }>(`/attendance/employee/${employeeId}/year`),
  });
}

export function useDayDetail(employeeId: string, date: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "day", employeeId, date],
    queryFn: () => apiGet<DayDetail>(`/attendance/employee/${employeeId}/day/${date}`),
  });
}

export function useShiftSwaps(employeeId: string) {
  return useQuery({
    queryKey: [...ATTENDANCE_KEY, "swaps", employeeId],
    queryFn: () => apiGet<SwapLine[]>(`/employees/${employeeId}/shift-swaps`),
  });
}

/** A change to a day changes every screen that shows days, so all attendance data is read again. */
function useRefreshAttendance() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY });
    queryClient.invalidateQueries({ queryKey: CORRECTIONS_KEY });
  };
}

export function useCreateSwap(employeeId: string) {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (input: { date: string; shift_id: string; reason: string }) =>
      apiPost<{ swap: SwapLine }>(`/employees/${employeeId}/shift-swaps`, input),
    onSuccess: refresh,
  });
}

export function useCancelSwap() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (input: { swapId: string; reason: string }) =>
      apiPost<{ swap: SwapLine }>(`/shift-swaps/${input.swapId}/cancel`, { reason: input.reason }),
    onSuccess: refresh,
  });
}

/** Asks the server what the day would look like; nothing is stored. `null` means "form not complete". */
export function usePreviewCorrection(body: CorrectionBody | null) {
  return useQuery({
    queryKey: [...CORRECTIONS_KEY, "preview", body],
    queryFn: () => apiPost<PreviewAnswer>("/regularisations/preview", body),
    enabled: body !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreateCorrection() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (body: CorrectionBody) =>
      apiPost<{ correction: Correction }>("/regularisations", body),
    onSuccess: refresh,
  });
}

export function useBulkPreview() {
  return useMutation({
    mutationFn: (body: BulkBody) =>
      apiPost<BulkPreviewAnswer>("/regularisations/bulk/preview", body),
  });
}

export function useBulkCreate() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (body: BulkBody) => apiPost<BulkCreated>("/regularisations/bulk", body),
    onSuccess: refresh,
  });
}

export function useBatchAction() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (input: { batchId: string; action: "approve-all" | "reverse"; reason?: string }) =>
      apiPost<{ approved?: number; reversed?: number; failed?: { id: string; code: string }[] }>(
        `/regularisations/batches/${input.batchId}/${input.action}`,
        input.action === "reverse" ? { reason: input.reason } : {},
      ),
    onSuccess: refresh,
  });
}
