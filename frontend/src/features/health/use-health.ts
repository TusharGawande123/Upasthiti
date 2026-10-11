// Asks the backend if it is up (GET /api/v1/health) and re-checks every 30 seconds.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api-client";

export type HealthResponse = {
  status: "ok";
  version: string;
  server_time: string; // ISO 8601, UTC
};

const RECHECK_EVERY_MS = 30_000;

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<HealthResponse>("/health"),
    refetchInterval: RECHECK_EVERY_MS,
  });
}
