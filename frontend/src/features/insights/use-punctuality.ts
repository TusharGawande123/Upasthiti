// Server data of the punctuality page (spec M5 §5.4, F-9). Field names follow
// backend/app/modules/dashboard/schemas.py (PunctualityResponse). The server sends no comparison,
// so the page asks a second time for the period of the same length just before.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export const MAX_PERIOD_DAYS = 92;

export type GroupBy = "department" | "category" | "shift" | "weekday";

export type PunctualityGroup = {
  key: string;
  label: string;
  arrivals: number;
  late_count: number;
  on_time_percent: number;
  average_late_min: number;
};

export type PunctualityResponse = {
  on_time_percent: number;
  arrivals: number;
  late_count: number;
  average_late_min: number;
  early_exit_count: number;
  weekly: { week_start: string; on_time_percent: number }[];
  groups: PunctualityGroup[];
  top_late: {
    employee: { id: string; code: string; name: string };
    late_count: number;
    late_min: number;
  }[];
};

export type Period = { dateFrom: string; dateTo: string };

export type PunctualityScope = Period & {
  plantId: string;
  includeDemo: boolean;
  groupBy: GroupBy;
};

const DAY = 24 * 60 * 60 * 1000;

export function daysInPeriod({ dateFrom, dateTo }: Period): number {
  return Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / DAY) + 1;
}

/** The period of the same length that ends the day before this one starts. */
export function previousPeriod(period: Period): Period {
  const length = daysInPeriod(period);
  const before = (moment: number) => new Date(moment).toISOString().slice(0, 10);
  const end = Date.parse(period.dateFrom) - DAY;
  return { dateFrom: before(end - (length - 1) * DAY), dateTo: before(end) };
}

function address(scope: PunctualityScope): string {
  return `/insights/punctuality${queryString({
    date_from: scope.dateFrom,
    date_to: scope.dateTo,
    plant_id: scope.plantId || undefined,
    group_by: scope.groupBy,
    include_demo: scope.includeDemo || undefined,
  })}`;
}

export function usePunctuality(scope: PunctualityScope, enabled = true) {
  return useQuery({
    queryKey: ["insights", "punctuality", scope],
    queryFn: () => apiGet<PunctualityResponse>(address(scope)),
    placeholderData: keepPreviousData,
    enabled,
  });
}
