// Server data and actions for gate kiosks (admin side). Super Admin and a Plant Head (own
// plant) manage kiosks; a Corporate Head only views them. The server checks this again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export type KioskStatus = "pending" | "active" | "revoked";

/** What the device is doing now, worked out by the server when asked (M4 spec §7 rule 15). */
export type DeviceState =
  | "online"
  | "offline"
  | "needs_location"
  | "sending"
  | "revoked"
  | "pending";

export type DeviceQueue = { count: number; bytes: number; oldest_punch_at: string | null };
export type DeviceLocation = {
  state: string | null;
  accuracy_m: number | null;
  at: string | null;
  inside: "inside" | "edge" | "outside" | null;
  // The position only comes for the Super Admin and the plant's own Plant Head.
  lat: number | null;
  lon: number | null;
};
export type DeviceStorage = {
  persisted: boolean | null;
  quota_mb: number | null;
  usage_mb: number | null;
  offline_ready: boolean | null;
};

export type Kiosk = {
  id: string;
  plant_id: string;
  name: string;
  status: KioskStatus;
  registered_at: string | null;
  registered_accuracy_m: string | null;
  last_seen_at: string | null;
  app_version: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  // M2: tones and voice switched off at this gate (F-1); the last test card scan (F-27).
  sound_muted: boolean;
  last_self_test_at: string | null;
  // M4: the state and the facts from the gate's last heartbeat (all optional on an old server).
  state?: DeviceState;
  last_contact_at?: string | null;
  last_punch_at?: string | null;
  last_sync_at?: string | null;
  queue?: DeviceQueue | null;
  location?: DeviceLocation | null;
  storage?: DeviceStorage | null;
  battery?: { level: number; charging: boolean | null } | null;
  camera_ok?: boolean | null;
};

// Shown to the admin once: only a keyed hash of the code is stored on the server.
export type KioskWithCode = { kiosk: Kiosk; pairing_code: string; code_expires_at: string };

const KIOSKS_KEY = ["kiosks"];

export type StatusSummary = {
  online: number;
  offline: number;
  needs_location: number;
  sending: number;
  alerts: {
    kiosk: { id: string; name: string };
    plant: { id: string; code: string; name: string };
    offline_since: string;
  }[];
};

/** The offline badge, the dashboard card and the offline alerts (F-36, F-46). Polled every minute. */
export function useStatusSummary() {
  return useQuery({
    queryKey: [...KIOSKS_KEY, "status-summary"],
    queryFn: () => apiGet<StatusSummary>("/kiosks/status-summary"),
    refetchInterval: 60_000,
  });
}

export type HealthDay = {
  date: string;
  online_minutes: number;
  offline_minutes: number;
  shift_minutes: number;
  stretches: { start: string; end: string; state: "online" | "offline" }[];
};

export type KioskHealth = {
  days: HealthDay[];
  latest: {
    battery: { level: number; charging: boolean | null } | null;
    camera_ok: boolean | null;
    storage: DeviceStorage | null;
    app_version: string | null;
    at: string | null;
  };
};

/** Battery, camera, storage and the last 7 days online and offline of one device (F-3). */
export function useKioskHealth(kioskId: string | null) {
  return useQuery({
    queryKey: [...KIOSKS_KEY, "health", kioskId],
    queryFn: () => apiGet<KioskHealth>(`/kiosks/${kioskId}/health`),
    enabled: kioskId !== null,
  });
}

export function useKiosks(
  filters: { plant_id?: string; status?: KioskStatus; state?: DeviceState } = {},
  options: { refetchMs?: number } = {},
) {
  return useQuery({
    queryKey: [...KIOSKS_KEY, filters],
    queryFn: () => apiGet<Kiosk[]>(`/kiosks${queryString(filters)}`),
    refetchInterval: options.refetchMs,
  });
}

function useRefreshKiosks() {
  const queryClient = useQueryClient();
  return () => {
    // Plant counts (readiness, setup wizard) depend on active kiosks too.
    queryClient.invalidateQueries({ queryKey: KIOSKS_KEY });
    queryClient.invalidateQueries({ queryKey: ["plants"] });
  };
}

export function useCreateKiosk() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: (input: { plant_id: string; name: string }) =>
      apiPost<KioskWithCode>("/kiosks", input),
    onSuccess: refresh,
  });
}

export function useNewPairingCode() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: (kioskId: string) => apiPost<KioskWithCode>(`/kiosks/${kioskId}/pairing-code`),
    onSuccess: refresh,
  });
}

export function useRenameKiosk() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiPatch<Kiosk>(`/kiosks/${id}`, { name }),
    onSuccess: refresh,
  });
}

/** Switches the tones and the spoken line off or on at one gate. */
export function useSetKioskSound() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: ({ id, sound_muted }: { id: string; sound_muted: boolean }) =>
      apiPatch<Kiosk>(`/kiosks/${id}`, { sound_muted }),
    onSuccess: refresh,
  });
}

export function useRevokeKiosk() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<Kiosk>(`/kiosks/${id}/revoke`, { reason }),
    onSuccess: refresh,
  });
}
