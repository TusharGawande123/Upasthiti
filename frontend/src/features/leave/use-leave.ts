// Server data and actions for leave (spec M5 §5.3). Field names follow
// backend/app/modules/leave/schemas.py. The reason fields are null for everyone except the
// Super Admin (decision 0036 line 7).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type Leave = {
  id: string;
  employee: { id: string; code: string; name: string };
  from_date: string;
  to_date: string;
  working_days: number; // weekly offs and holidays inside the range are not counted
  is_paid: boolean;
  reason: string | null;
  created_by: { id: string; name: string };
  created_at: string;
  cancelled: { by: { id: string; name: string }; at: string; reason: string | null } | null;
};

export type LeaveFilters = {
  plant_id?: string;
  month?: string; // "2026-11"
  is_paid?: boolean;
  state?: "active" | "cancelled";
};

export type NewLeave = {
  employee_id: string;
  from_date: string;
  to_date: string;
  is_paid: boolean;
  reason: string;
};

const LEAVE_KEY = ["leave"] as const;

export function useLeave(filters: LeaveFilters) {
  return useQuery({
    queryKey: [...LEAVE_KEY, filters],
    queryFn: () => apiGet<Page<Leave>>(`/leave${queryString({ ...filters, page_size: 200 })}`),
  });
}

// Leave changes the attendance of the days it covers, so the attendance lists are read again too.
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: LEAVE_KEY });
    queryClient.invalidateQueries({ queryKey: ["attendance"] });
  };
}

export function useCreateLeave() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (input: NewLeave) => apiPost<{ leave: Leave }>("/leave", input),
    onSuccess: refresh,
  });
}

export function useCancelLeave() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<{ leave: Leave }>(`/leave/${id}/cancel`, { reason }),
    onSuccess: refresh,
  });
}
