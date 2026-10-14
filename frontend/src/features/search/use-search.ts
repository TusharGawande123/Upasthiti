// Quick search for the Ctrl+K palette: employees, plants and kiosks the user may see.
// The server needs at least 2 characters and keeps results inside the user's plants.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";

export type SearchResults = {
  employees: {
    id: string;
    employee_code: string;
    full_name: string;
    plant_code: string;
    status: string;
  }[];
  plants: { id: string; code: string; name: string }[];
  kiosks: { id: string; name: string; plant_id: string }[];
};

export const MIN_SEARCH_LENGTH = 2;

export function useQuickSearch(text: string) {
  const query = text.trim();
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  });
}
