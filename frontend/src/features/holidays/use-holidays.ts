// Server data and actions for the holiday calendar (spec M5 §5.3). Field names follow
// backend/app/modules/holidays/schemas.py. Everyone in scope reads; only the Super Admin writes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export type Holiday = {
  id: string;
  date: string; // "2026-11-08"
  name: string;
  is_paid: boolean;
  all_plants: boolean;
  plants: { id: string; code: string }[];
  created_by: { id: string; name: string };
  created_at: string;
  cancelled: { by: { id: string; name: string }; at: string; reason: string } | null;
};

export type NewHoliday = {
  date: string;
  name: string;
  is_paid: boolean;
  all_plants: boolean;
  plant_ids: string[];
};

export const HOLIDAYS_KEY = ["holidays"] as const;

export function useHolidays(year: number, plantId: string) {
  return useQuery({
    queryKey: [...HOLIDAYS_KEY, year, plantId],
    queryFn: () =>
      apiGet<Holiday[]>(`/holidays${queryString({ year, plant_id: plantId || undefined })}`),
  });
}

// A holiday changes the days of many people, so every list that shows days is read again.
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["holidays", "leave", "attendance"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useCreateHoliday() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (input: NewHoliday) => apiPost<{ holiday: Holiday }>("/holidays", input),
    onSuccess: refresh,
  });
}

export function useCancelHoliday() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<{ holiday: Holiday }>(`/holidays/${id}/cancel`, { reason }),
    onSuccess: refresh,
  });
}
