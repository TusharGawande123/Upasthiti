// Server data and actions for contractors: one company-wide list that supplies temporary
// workers. Everyone reads it; only the Super Admin changes it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";

export type Contractor = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean;
  active_workers: number;
};

export type ContractorInput = {
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
};

const CONTRACTORS_KEY = ["contractors"];

export function useContractors() {
  return useQuery({
    queryKey: CONTRACTORS_KEY,
    queryFn: () => apiGet<Contractor[]>("/contractors"),
  });
}

function useRefreshContractors() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CONTRACTORS_KEY });
}

export function useSaveContractor() {
  const refresh = useRefreshContractors();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ContractorInput }) =>
      id
        ? apiPatch<Contractor>(`/contractors/${id}`, input)
        : apiPost<Contractor>("/contractors", input),
    onSuccess: refresh,
  });
}

export function useContractorActiveToggle() {
  const refresh = useRefreshContractors();
  return useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason: string }) =>
      apiPost<Contractor>(`/contractors/${id}/${active ? "reactivate" : "deactivate"}`, { reason }),
    onSuccess: refresh,
  });
}
