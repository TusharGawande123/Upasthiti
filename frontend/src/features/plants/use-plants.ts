// Server data about plants. Grows in slice B (plant pages); the users form already needs the list.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type Plant = {
  id: string;
  name: string;
  code: string;
  address: string;
  is_active: boolean;
  geofence_set: boolean;
  active_kiosks: number;
  active_employees: number;
};

export function usePlants(filters: { is_active?: boolean } = {}) {
  return useQuery({
    queryKey: ["plants", filters],
    queryFn: () => apiGet<Page<Plant>>(`/plants${queryString({ ...filters, page_size: 200 })}`),
  });
}
