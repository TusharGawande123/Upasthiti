// Server data and actions for the data-request register (M6 spec 4.1 and 7.7). Field names follow
// backend/app/modules/data_requests/schemas.py. Super Admin only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export const REQUEST_KINDS = [
  "access",
  "correction",
  "erasure",
  "consent_withdrawal",
  "complaint",
  "other",
] as const;
export const CHANNELS = ["in_person", "email", "phone_call", "letter"] as const;
export const REQUEST_STATUSES = [
  "open",
  "identity_checked",
  "in_progress",
  "answered",
  "closed",
] as const;
export const EVENT_TYPES = ["identity_checked", "action_taken", "answer_sent", "closed"] as const;
export const OUTCOMES = ["done", "partly_done", "refused"] as const;

export type RequestKind = (typeof REQUEST_KINDS)[number];
export type Channel = (typeof CHANNELS)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type Outcome = (typeof OUTCOMES)[number];

export type DataRequest = {
  id: string;
  kind: RequestKind;
  channel: Channel;
  received_on: string;
  due_on: string;
  note: string | null;
  status: RequestStatus;
  outcome: Outcome | null;
  // Negative when overdue; null once the request is closed.
  days_left: number | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  employee_left: boolean;
  created_at: string;
};

export type RequestEvent = {
  id: string;
  event_type: EventType;
  detail: string;
  outcome: Outcome | null;
  audit_entry_id: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
};

export type DataRequestDetail = DataRequest & { events: RequestEvent[] };

export type RequestFilters = {
  status?: string;
  kind?: string;
  overdue?: boolean;
  page: number;
};

export type NewDataRequest = {
  kind: RequestKind;
  employee_id?: string;
  channel: Channel;
  received_on: string;
  note?: string;
};

export type NewEvent = {
  event_type: EventType;
  detail: string;
  outcome?: Outcome;
};

const KEY = ["data-requests"] as const;

// What may follow the last step (spec 7.7 rule 2); the server checks it again.
export function nextSteps(status: RequestStatus): EventType[] {
  switch (status) {
    case "open":
      return ["identity_checked"];
    case "identity_checked":
      return ["action_taken"];
    case "in_progress":
      return ["action_taken", "answer_sent"];
    case "answered":
      return ["closed"];
    default:
      return [];
  }
}

export function useDataRequests(filters: RequestFilters) {
  return useQuery({
    queryKey: [...KEY, "list", filters],
    queryFn: () =>
      apiGet<Page<DataRequest>>(`/data-requests${queryString({ ...filters, page_size: 25 })}`),
    placeholderData: (previous) => previous,
  });
}

// The banner: requests that are due in 5 days or less, or already late.
export function useDueSoonRequests() {
  return useQuery({
    queryKey: [...KEY, "due-soon"],
    queryFn: () =>
      apiGet<Page<DataRequest>>(`/data-requests${queryString({ due_soon: true, page_size: 1 })}`),
  });
}

export function useDataRequest(requestId: string) {
  return useQuery({
    queryKey: [...KEY, "one", requestId],
    queryFn: () => apiGet<DataRequestDetail>(`/data-requests/${requestId}`),
  });
}

export function useCreateDataRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDataRequest) => apiPost<DataRequestDetail>("/data-requests", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddRequestEvent(requestId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewEvent) =>
      apiPost<RequestEvent>(`/data-requests/${requestId}/events`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
