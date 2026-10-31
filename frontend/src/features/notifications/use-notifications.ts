// Server data of the notification centre (spec M5 §5.7): the bell count (polled every 60 s), the
// list, mark read, and the own email preferences. Field names follow
// backend/app/modules/notifications/schemas.py. A notification carries a translation key and
// values, never a name (decision 0036), so the texts are written in common.json.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export const BELL_POLL_MS = 60_000;

export const KINDS = [
  "still_inside",
  "device_offline",
  "many_rejections",
  "incomplete_days",
  "review_digest",
  "correction_requested",
  "correction_decided",
  "absence_streak",
  "monthly_register",
] as const;

export type NotificationKind = (typeof KINDS)[number];

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  severity: "info" | "warning" | "urgent";
  plant: { id: string; code: string; name: string } | null;
  text_key: string;
  params: Record<string, string | number | null>;
  link: string;
  created_at: string;
  resolved_at: string | null;
  read: boolean;
};

export type NotificationFilters = {
  unread?: boolean;
  kind?: string;
  page?: number;
  page_size?: number;
};

const KEY = ["notifications"];

export function useUnreadCount() {
  return useQuery({
    queryKey: [...KEY, "unread"],
    queryFn: () => apiGet<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: BELL_POLL_MS,
  });
}

export function useNotifications(filters: NotificationFilters, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "list", filters],
    queryFn: () =>
      apiGet<Page<NotificationItem>>(
        `/notifications${queryString({ ...filters, unread: filters.unread || undefined })}`,
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useMarkRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => apiPost<void>(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
}

export function useMarkAllRead() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => apiPost<void>("/notifications/read-all"),
    onSuccess: refresh,
  });
}

export type Preferences = {
  email_enabled: boolean;
  email_kinds: string[];
  // false: the server has no email settings, so the switches are hidden.
  email_configured: boolean;
  has_email: boolean;
};

export function usePreferences() {
  return useQuery({
    queryKey: [...KEY, "preferences"],
    queryFn: () => apiGet<Preferences>("/me/notification-preferences"),
  });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email_enabled: boolean; email_kinds: string[] }) =>
      apiPut<Preferences>("/me/notification-preferences", input),
    onSuccess: (result) => queryClient.setQueryData([...KEY, "preferences"], result),
  });
}

export function useSendTestEmail() {
  return useMutation({ mutationFn: () => apiPost<{ sent: boolean }>("/notifications/test-email") });
}
