// Server data and actions for employees: list, detail, timeline, create/edit, transfer,
// bulk changes, Excel import, mark as left and reactivate.
//
// A Corporate Head's change does not happen at once: the server answers 202 with a change
// request that waits for the Super Admin (decision 0005). `isPendingApproval` tells the two
// answers apart so the screen can say "Sent for approval" instead of "Saved".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type EmployeeType = "permanent" | "temporary";
export type EmployeeStatus = "active" | "left";

export type Employee = {
  id: string;
  employee_code: string;
  full_name: string;
  type: EmployeeType;
  plant_id: string;
  plant_code: string;
  category_id: string;
  category_name: string;
  department_id: string | null;
  department_name: string | null;
  shift_id: string | null;
  shift_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  punch_method: "face" | "qr";
  hourly_rate: string | null; // money is always a string like "85.00", never a float
  ot_rate_per_hour: string | null;
  status: EmployeeStatus;
  joined_on: string;
  left_on: string | null;
  left_reason: string | null;
  has_pending_change: boolean;
};

export type EmployeeDetail = {
  employee: Employee;
  shift_history: {
    shift_id: string;
    shift_name: string;
    from_date: string;
    to_date: string | null;
  }[];
  plant_history: {
    plant_id: string;
    plant_code: string;
    from_date: string;
    to_date: string | null;
    reason: string | null;
  }[];
};

export type TimelineEvent = {
  at: string;
  action: string;
  actor_name: string | null;
  approved_through_request: boolean;
  changed_fields: string[];
  reason: string | null;
};

export type EmployeeFilters = {
  q?: string;
  plant_id?: string;
  type?: EmployeeType;
  status?: EmployeeStatus;
  category_id?: string;
  department_id?: string;
  shift_id?: string;
  contractor_id?: string;
  page: number;
  page_size?: number;
};

export type NewEmployee = {
  employee_code: string;
  full_name: string;
  type: EmployeeType;
  plant_id: string;
  category_id: string;
  department_id?: string | null;
  shift_id: string;
  contractor_id?: string | null;
  hourly_rate?: string | null;
  ot_rate_per_hour?: string | null;
  joined_on: string;
};

export type EmployeeChanges = Partial<Omit<NewEmployee, "employee_code" | "plant_id">> & {
  shift_from?: string;
  reason?: string;
};

export type TransferInput = {
  to_plant_id: string;
  category_id: string;
  department_id?: string | null;
  shift_id: string;
  effective_from: string;
  reason: string;
};

export type BulkAction = "change_shift" | "change_department" | "change_category" | "mark_left";

export type BulkInput = {
  action: BulkAction;
  employee_ids: string[];
  params: Record<string, string | null>;
  reason: string;
};

// The 202 answer for a Corporate Head.
export type PendingApproval = { change_request_id: string; status: "pending"; summary: string };

export type ImportRowError = { row: number; column: string; code: string; message: string };
export type ImportResult = {
  ok_rows: number;
  error_rows: number;
  errors: ImportRowError[];
  created?: number | null;
};

export function isPendingApproval(result: unknown): result is PendingApproval {
  return typeof result === "object" && result !== null && "change_request_id" in result;
}

export const MAX_BULK = 500;
const EMPLOYEES_KEY = ["employees"];

export function useEmployees(filters: EmployeeFilters) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, "list", filters],
    queryFn: () =>
      apiGet<Page<Employee>>(`/employees${queryString({ page_size: 50, ...filters })}`),
    // Keep the old page on screen while the next one loads (no jumping table).
    placeholderData: (previous) => previous,
  });
}

export function useEmployee(employeeId: string) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, employeeId],
    queryFn: () => apiGet<EmployeeDetail>(`/employees/${employeeId}`),
  });
}

export function useTimeline(employeeId: string) {
  return useQuery({
    queryKey: [...EMPLOYEES_KEY, employeeId, "timeline"],
    queryFn: () => apiGet<TimelineEvent[]>(`/employees/${employeeId}/timeline`),
  });
}

// After any employee change the lists, details, plant counts and the approvals inbox may
// all be different, so all of them are refreshed.
function useRefreshPeople() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY });
    queryClient.invalidateQueries({ queryKey: ["plants"] });
    queryClient.invalidateQueries({ queryKey: ["change-requests"] });
  };
}

export function useCreateEmployee() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: NewEmployee) => apiPost<Employee | PendingApproval>("/employees", input),
    onSuccess: refresh,
  });
}

export function useUpdateEmployee(employeeId: string) {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (changes: EmployeeChanges) =>
      apiPatch<Employee | PendingApproval>(`/employees/${employeeId}`, changes),
    onSuccess: refresh,
  });
}

export function useTransferEmployee(employeeId: string) {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: TransferInput) =>
      apiPost<Employee | PendingApproval>(`/employees/${employeeId}/transfer`, input),
    onSuccess: refresh,
  });
}

export function useMarkLeft(employeeId: string) {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: { left_on: string; reason: string }) =>
      apiPost<Employee>(`/employees/${employeeId}/mark-left`, input),
    onSuccess: refresh,
  });
}

export function useReactivate(employeeId: string) {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: { joined_on: string; reason: string }) =>
      apiPost<Employee>(`/employees/${employeeId}/reactivate`, input),
    onSuccess: refresh,
  });
}

export function useBulkChange() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: (input: BulkInput) =>
      apiPost<{ updated: number } | PendingApproval>("/employees/bulk", input),
    onSuccess: refresh,
  });
}

/** Dry run (`save: false`) checks the file and saves nothing; `save: true` saves all or nothing. */
export function useImportEmployees() {
  const refresh = useRefreshPeople();
  return useMutation({
    mutationFn: ({ file, save }: { file: File; save: boolean }) =>
      apiUpload<ImportResult | PendingApproval>(`/employees/import?dry_run=${!save}`, file),
    onSuccess: (_result, { save }) => {
      if (save) refresh();
    },
  });
}

export const IMPORT_TEMPLATE_URL = "/api/v1/employees/import/template.xlsx";
