// Server data and actions for "Needs review" (spec M4 §5.3). Super Admin only: the server
// answers FORBIDDEN to everyone else, and the page and menu entry are hidden from them too.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";
import {
  PUNCHES_KEY,
  type PunchDetail,
  type PunchItem,
  type PunchReview,
} from "../punches/use-punches";

export type ReviewTab = "to_check" | "rejected" | "reviewed";

export const REVIEW_KEY = ["review"] as const;
const REFRESH_EVERY_MS = 30_000;

export type ReviewFilters = {
  tab: ReviewTab;
  date_from?: string;
  date_to?: string;
  plant_id?: string;
  kiosk_id?: string;
  code?: string;
  method?: "qr" | "face";
  was_offline?: boolean;
  employee_id?: string;
  q?: string;
  names_employee?: boolean;
  include_cooldown?: boolean;
  page: number;
  page_size?: number;
};

export type ReviewPunch = PunchItem & {
  time_proof: "anchored" | "unproven" | null;
  // The person whose code was typed when the face did not match (the punch "names" them).
  claimed_employee: { id: string; code: string; name: string } | null;
};

export type ReviewListItem = {
  punch: ReviewPunch;
  latest_review: PunchReview | null;
  approvable: boolean;
};

export type ReviewSummary = {
  to_check: number;
  rejected_last_7_days: number;
  by_code: Record<string, number>;
};

export type DigestPlant = {
  plant: { id: string; code: string; name: string };
  flagged: number;
  rejected_with_employee: number;
  to_check: number;
  device_offline_minutes_in_shifts: number;
};

export type ReviewDigest = { date: string; plants: DigestPlant[] };

export type ContextFence = {
  version_id: string;
  version: number;
  shape: "circle" | "polygon";
  geojson: GeoJSON.Geometry;
  radius_m: number | null;
  buffer_m: number;
  was_current_at_punch_time: boolean;
};

export type RelatedPunch = {
  punch: PunchDetail;
  relation: "travel" | "two_devices" | "order";
  distance_m: number | null;
  minutes_apart: number;
  speed_kmh: number | null;
};

export type ReviewHint = {
  kind: "employee_rejections" | "device_edge_flags" | "card_two_devices";
  count: number;
  days: number;
  // The query of the linked "Needs review" list (tab, employee, device, code and the dates).
  filter: Record<string, string>;
};

export type ReviewContext = {
  punch: PunchDetail;
  claimed_employee: { id: string; code: string; name: string } | null;
  geofence: ContextFence | null;
  distance_m: number | null;
  margin_m: number | null;
  related: RelatedPunch[];
  suggestion: { direction: "in" | "out" } | null;
  nearby_counted: { punch_id: string; punch_time: string; direction: "in" | "out" }[];
  reviews: PunchReview[];
  hints: ReviewHint[];
  approvable: boolean;
  limits: { impossible_travel_kmh: number; punch_cooldown_minutes: number };
};

export type ReviewAction = "confirm" | "not_accepted" | "approve";

export type ReviewRequest = {
  action: ReviewAction;
  reason?: string;
  direction?: "in" | "out";
  expected_latest_review_id: string | null;
};

export function useReviewList(filters: ReviewFilters) {
  return useQuery({
    queryKey: [...REVIEW_KEY, "list", filters],
    queryFn: () =>
      apiGet<Page<ReviewListItem>>(`/reviews${queryString({ page_size: 50, ...filters })}`),
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_EVERY_MS,
  });
}

/** The number on the "Needs review" menu item and the dashboard card. Super Admin only. */
export function useReviewSummary(enabled: boolean, plantId?: string) {
  return useQuery({
    queryKey: [...REVIEW_KEY, "summary", plantId ?? ""],
    queryFn: () => apiGet<ReviewSummary>(`/reviews/summary${queryString({ plant_id: plantId })}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useReviewDigest(date: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...REVIEW_KEY, "digest", date ?? "yesterday"],
    queryFn: () => apiGet<ReviewDigest>(`/reviews/digest${queryString({ date })}`),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useReviewContext(punchId: string | null) {
  return useQuery({
    queryKey: [...REVIEW_KEY, "context", punchId],
    queryFn: () => apiGet<ReviewContext>(`/punches/${punchId}/review-context`),
    enabled: punchId !== null,
    // Always the latest: another Super Admin may have reviewed the punch meanwhile.
    gcTime: 0,
  });
}

export function useReviewPunch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ punchId, ...body }: ReviewRequest & { punchId: string }) =>
      apiPost<{ review: PunchReview }>(`/punches/${punchId}/reviews`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REVIEW_KEY });
      queryClient.invalidateQueries({ queryKey: PUNCHES_KEY });
    },
  });
}
