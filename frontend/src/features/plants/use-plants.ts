// Server data and actions for plants and their setup: details, readiness, geofence versions,
// departments, employee categories and shifts. Only the Super Admin may change plant setup;
// the server checks this again on every request.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type Plant = {
  id: string;
  name: string;
  code: string;
  address: string;
  lat: string | null;
  lon: string | null;
  is_active: boolean;
  geofence_set: boolean;
  active_kiosks: number;
  active_employees: number;
};

export type Readiness = {
  plant_id: string;
  geofence: boolean;
  active_shifts: number;
  active_categories: number;
  active_kiosks: number;
  active_employees: number;
  ready: boolean;
  // M4: a device of this plant works right now, and its location is good (optional on old servers).
  device_online?: boolean;
  location_good?: boolean;
};

export type SetupStepKey = "plants" | "geofence" | "shifts_and_categories" | "kiosk" | "employees";
export type SetupStatus = { steps: { key: SetupStepKey; done: boolean }[] };

export type GeofenceShape = "polygon" | "circle";
export type Geofence = {
  id: string;
  version: number;
  shape: GeofenceShape;
  // A GeoJSON Polygon, or a Point (the centre) when the shape is a circle.
  geojson: GeoJSON.Polygon | GeoJSON.Point;
  radius_m: string | null;
  buffer_m: number;
  is_current: boolean;
  created_at: string;
  created_by: string | null;
};

export type NewGeofence = {
  shape: GeofenceShape;
  geojson: GeoJSON.Polygon | GeoJSON.Point;
  radius_m?: number;
  buffer_m: number;
  reason?: string;
};

export type NamedItem = { id: string; plant_id: string; name: string; is_active: boolean };

export type Shift = {
  id: string;
  plant_id: string;
  name: string;
  start_time: string; // "07:00:00"
  end_time: string;
  crosses_midnight: boolean;
  grace_min: number;
  half_day_min: number;
  ot_after_min: number;
  is_active: boolean;
};

export type ShiftInput = {
  name: string;
  start_time: string;
  end_time: string;
  grace_min: number;
  half_day_min: number;
  ot_after_min: number;
};

// Departments and categories behave the same; only the address differs.
export type NamedItemKind = "departments" | "categories";

const PLANTS_KEY = ["plants"];

export function usePlants(filters: { is_active?: boolean } = {}) {
  return useQuery({
    queryKey: [...PLANTS_KEY, "list", filters],
    queryFn: () => apiGet<Page<Plant>>(`/plants${queryString({ ...filters, page_size: 200 })}`),
  });
}

export function usePlant(plantId: string) {
  return useQuery({
    queryKey: [...PLANTS_KEY, plantId],
    queryFn: () => apiGet<Plant>(`/plants/${plantId}`),
  });
}

export function useReadiness(plantId: string) {
  return useQuery({
    queryKey: [...PLANTS_KEY, plantId, "readiness"],
    queryFn: () => apiGet<Readiness>(`/plants/${plantId}/readiness`),
  });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: [...PLANTS_KEY, "setup-status"],
    queryFn: () => apiGet<SetupStatus>("/setup/status"),
  });
}

export function useGeofenceVersions(plantId: string) {
  return useQuery({
    queryKey: [...PLANTS_KEY, plantId, "geofence-versions"],
    queryFn: () => apiGet<Geofence[]>(`/plants/${plantId}/geofence/versions`),
  });
}

export function useNamedItems(plantId: string, kind: NamedItemKind) {
  return useQuery({
    queryKey: [...PLANTS_KEY, plantId, kind],
    queryFn: () => apiGet<NamedItem[]>(`/plants/${plantId}/${kind}`),
  });
}

export function useShifts(plantId: string) {
  return useQuery({
    queryKey: [...PLANTS_KEY, plantId, "shifts"],
    queryFn: () => apiGet<Shift[]>(`/plants/${plantId}/shifts`),
  });
}

// Every plant change can alter counts on other screens (list, readiness, wizard), so all
// plant data is refreshed after a successful change.
function useRefreshPlants() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PLANTS_KEY });
}

export function useAddClientPlants() {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: () => apiPost<{ created: number; skipped: number }>("/setup/client-plants"),
    onSuccess: refresh,
  });
}

export function useCreatePlant() {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: (input: { name: string; code: string; address: string }) =>
      apiPost<Plant>("/plants", input),
    onSuccess: refresh,
  });
}

export function useUpdatePlant(plantId: string) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: (input: { name: string; address: string }) =>
      apiPatch<Plant>(`/plants/${plantId}`, input),
    onSuccess: refresh,
  });
}

export function usePlantActiveToggle(plantId: string) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: ({ active, reason }: { active: boolean; reason: string }) =>
      apiPost<Plant>(`/plants/${plantId}/${active ? "reactivate" : "deactivate"}`, { reason }),
    onSuccess: refresh,
  });
}

export function useSaveGeofence(plantId: string) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: (input: NewGeofence) => apiPut<Geofence>(`/plants/${plantId}/geofence`, input),
    onSuccess: refresh,
  });
}

export function useCreateNamedItem(plantId: string, kind: NamedItemKind) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: (name: string) => apiPost<NamedItem>(`/plants/${plantId}/${kind}`, { name }),
    onSuccess: refresh,
  });
}

export function useNamedItemAction(kind: NamedItemKind) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: (
      change: { id: string; rename: string } | { id: string; active: boolean; reason: string },
    ) =>
      "rename" in change
        ? apiPatch<NamedItem>(`/${kind}/${change.id}`, { name: change.rename })
        : apiPost<NamedItem>(
            `/${kind}/${change.id}/${change.active ? "reactivate" : "deactivate"}`,
            {
              reason: change.reason,
            },
          ),
    onSuccess: refresh,
  });
}

export function useSaveShift(plantId: string) {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ShiftInput }) =>
      id
        ? apiPatch<Shift>(`/shifts/${id}`, input)
        : apiPost<Shift>(`/plants/${plantId}/shifts`, input),
    onSuccess: refresh,
  });
}

export function useShiftActiveToggle() {
  const refresh = useRefreshPlants();
  return useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason: string }) =>
      apiPost<Shift>(`/shifts/${id}/${active ? "reactivate" : "deactivate"}`, { reason }),
    onSuccess: refresh,
  });
}
