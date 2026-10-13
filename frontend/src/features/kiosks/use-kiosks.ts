// Server data and actions for gate kiosks (admin side). Super Admin and a Plant Head (own
// plant) manage kiosks; a Corporate Head only views them. The server checks this again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { queryString } from "@/lib/paging";

export type KioskStatus = "pending" | "active" | "revoked";

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
};

// Shown to the admin once: only a keyed hash of the code is stored on the server.
export type KioskWithCode = { kiosk: Kiosk; pairing_code: string; code_expires_at: string };

const KIOSKS_KEY = ["kiosks"];

export function useKiosks(
  filters: { plant_id?: string; status?: KioskStatus } = {},
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

export function useRevokeKiosk() {
  const refresh = useRefreshKiosks();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<Kiosk>(`/kiosks/${id}/revoke`, { reason }),
    onSuccess: refresh,
  });
}
