// Server data and actions for gate notices (spec M2 §5.4, F-25): the list, create, change and
// "End now". Everyone who sees the page reads the list; the server decides who may change what
// (`can_change` on each notice), and checks it again on every change.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type NoticeState = "scheduled" | "showing" | "ended";
export type NoticeLevel = "normal" | "important";

export type Notice = {
  id: string;
  plant: { id: string; code: string; name: string } | null; // null = every plant
  text: string;
  level: NoticeLevel;
  starts_at: string;
  ends_at: string;
  state: NoticeState;
  created_by: { id: string; name: string };
  created_at: string;
  ended_at: string | null;
  ended_by: { id: string; name: string } | null;
  can_change: boolean;
};

export type NoticeFilters = {
  plant_id?: string;
  all_plants?: boolean;
  state?: NoticeState;
  page: number;
  page_size?: number;
};

export type NoticeInput = {
  plant_id: string | null;
  text: string;
  level: NoticeLevel;
  starts_at: string;
  ends_at: string;
};

export const NOTICES_KEY = ["notices"] as const;

export function useNotices(filters: NoticeFilters) {
  return useQuery({
    queryKey: [...NOTICES_KEY, filters],
    queryFn: () => apiGet<Page<Notice>>(`/notices${queryString({ page_size: 50, ...filters })}`),
    placeholderData: (previous) => previous,
  });
}

function useRefreshNotices() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: NOTICES_KEY });
}

export function useCreateNotice() {
  const refresh = useRefreshNotices();
  return useMutation({
    mutationFn: (input: NoticeInput) => apiPost<Notice>("/notices", input),
    onSuccess: refresh,
  });
}

export function useUpdateNotice(noticeId: string) {
  const refresh = useRefreshNotices();
  return useMutation({
    mutationFn: (input: Partial<Omit<NoticeInput, "plant_id">>) =>
      apiPatch<Notice>(`/notices/${noticeId}`, input),
    onSuccess: refresh,
  });
}

export function useEndNotice() {
  const refresh = useRefreshNotices();
  return useMutation({
    mutationFn: (noticeId: string) => apiPost<Notice>(`/notices/${noticeId}/end`),
    onSuccess: refresh,
  });
}
