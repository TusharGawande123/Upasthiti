// Server data and actions for the approvals inbox. The Super Admin sees and decides every
// change request; a Corporate Head sees only their own and may withdraw a pending one.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type RequestKind =
  | "employee.create"
  | "employee.update"
  | "employee.transfer"
  | "employee.bulk"
  | "employee.import";

// "failed": the re-check at approval found a problem, so nothing was applied.
export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn" | "failed";

export type ChangeRequest = {
  id: string;
  kind: RequestKind;
  summary: string;
  status: RequestStatus;
  employee_id: string | null;
  plant_ids: string[];
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
};

const REQUESTS_KEY = ["change-requests"];

export function useChangeRequests(filters: {
  status?: RequestStatus;
  kind?: RequestKind;
  page: number;
}) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, "list", filters],
    queryFn: () =>
      apiGet<Page<ChangeRequest>>(`/change-requests${queryString({ page_size: 50, ...filters })}`),
  });
}

export function useChangeRequest(requestId: string | null) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, requestId],
    queryFn: () => apiGet<ChangeRequest>(`/change-requests/${requestId}`),
    enabled: requestId !== null,
  });
}

/** The number on the "Approvals" menu item. Only the Super Admin asks for it. */
export function usePendingCount(enabled: boolean) {
  return useQuery({
    queryKey: [...REQUESTS_KEY, "pending-count"],
    queryFn: () => apiGet<{ count: number }>("/change-requests/pending-count"),
    enabled,
    refetchInterval: 60_000,
  });
}

function useRefreshAfterDecision() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
    // An approved request changes employees and plant counts.
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    queryClient.invalidateQueries({ queryKey: ["plants"] });
  };
}

export function useDecideRequest() {
  const refresh = useRefreshAfterDecision();
  return useMutation({
    mutationFn: (
      decision:
        | { id: string; action: "approve"; note?: string }
        | { id: string; action: "reject"; reason: string }
        | { id: string; action: "withdraw" },
    ) => {
      if (decision.action === "approve") {
        return apiPost<ChangeRequest>(`/change-requests/${decision.id}/approve`, {
          note: decision.note || null,
        });
      }
      if (decision.action === "reject") {
        return apiPost<ChangeRequest>(`/change-requests/${decision.id}/reject`, {
          reason: decision.reason,
        });
      }
      return apiPost<ChangeRequest>(`/change-requests/${decision.id}/withdraw`);
    },
    onSuccess: refresh,
  });
}
