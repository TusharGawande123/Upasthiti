// Server data for the live dashboard and the emergency muster (spec M5 §5.4), and the "show demo
// plants" switch they share. Field names follow backend/app/modules/dashboard/schemas.py.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiBlob, apiGet } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

const REFRESH_EVERY_MS = 30_000;
const DEMO_KEY = "upasthiti.showDemoPlants";

export type DashPlant = { id: string; code: string; name: string; is_demo: boolean };

export type PlantNumbers = {
  inside_now: number;
  inside_temporary: number;
  expected: number;
  arrived: number;
  late: number;
  not_arrived: number;
  on_leave: number;
  off_today: number;
  exceptions: number;
  undecided: { short_hours: number; incomplete: number };
};

export type PlantLive = PlantNumbers & {
  plant: DashPlant;
  attendance_started: boolean;
  // contractor is null for "No contractor".
  by_contractor: { contractor: { id: string; name: string } | null; inside: number }[];
  shifts: {
    shift: { id: string; name: string; start_time: string; end_time: string };
    expected: number;
    arrived: number;
    late: number;
  }[];
};

export type LiveResponse = {
  generated_at: string;
  date: string;
  plants: PlantLive[];
  totals: PlantNumbers;
};

export type MusterPerson = {
  employee: {
    id: string;
    code: string;
    name: string;
    type: "permanent" | "temporary";
    category: string | null;
    department: string | null;
    contractor: string | null;
  };
  in_time: string;
  kiosk: { id: string; name: string } | null;
};

export type MusterResponse = {
  generated_at: string;
  plants: { plant: DashPlant; count: number; people: MusterPerson[] }[];
};

type Scope = { plantId: string; includeDemo: boolean };

function scopeQuery({ plantId, includeDemo }: Scope): string {
  return queryString({ plant_id: plantId || undefined, include_demo: includeDemo || undefined });
}

/** The numbers of today. Polled every 30 s (not while the tab is hidden); a failed refresh keeps
 * the last numbers so the screen can say "Could not refresh". */
export function useLiveDashboard(scope: Scope) {
  return useQuery({
    queryKey: ["dashboard", "live", scope.plantId, scope.includeDemo],
    queryFn: () => apiGet<LiveResponse>(`/dashboard/live${scopeQuery(scope)}`),
    refetchInterval: REFRESH_EVERY_MS,
    placeholderData: keepPreviousData,
  });
}

/** Everyone whose last punch is IN. The server sends the whole list; the page shows it in steps. */
export function useMuster(scope: Scope) {
  return useQuery({
    queryKey: ["dashboard", "muster", scope.plantId, scope.includeDemo],
    queryFn: () => apiGet<MusterResponse>(`/muster${scopeQuery(scope)}`),
    refetchInterval: REFRESH_EVERY_MS,
    placeholderData: keepPreviousData,
  });
}

export function downloadMusterPdf(scope: Scope): Promise<Blob> {
  return apiBlob(`/muster.pdf${scopeQuery(scope)}`, { method: "GET" });
}

function readDemoSwitch(): boolean {
  try {
    return localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    // Storage can be blocked; the switch then starts off.
    return false;
  }
}

/** The "Show demo plants" switch, remembered in this browser. Only the Super Admin sees it. */
export function useDemoSwitch(allowed: boolean) {
  const [on, setOn] = useState(readDemoSwitch);
  const change = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(DEMO_KEY, "1");
      else localStorage.removeItem(DEMO_KEY);
    } catch {
      // Not remembered; still applied for this visit.
    }
  }, []);
  return { showDemo: allowed && on, setShowDemo: change };
}
