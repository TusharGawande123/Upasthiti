// Server data for the audit log viewer (read-only).
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type AuditEntry = {
  id: string;
  at: string;
  actor_type: "user" | "kiosk" | "system";
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  plant_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  change_request_id: string | null;
};

export type AuditFilters = {
  from?: string;
  to?: string;
  actor_type?: string;
  action?: string;
  entity_type?: string;
  page: number;
};

export function useAudit(filters: AuditFilters) {
  return useQuery({
    queryKey: ["audit", filters],
    queryFn: () => apiGet<Page<AuditEntry>>(`/audit${queryString({ ...filters, page_size: 50 })}`),
  });
}
