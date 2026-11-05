// Server data and the download of the full data export (M6 spec 4.2). Super Admin only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { saveFile } from "@/features/attendance/use-attendance-admin";
import { apiBlob, apiGet } from "@/lib/api-client";
import { todayIst } from "@/lib/format";

export type RecentExport = {
  at: string;
  actor_name: string | null;
  status: "done" | "interrupted";
  size_bytes: number | null;
  row_count: number | null;
  reason: string | null;
};

export type ExportInput = { reason: string; password: string };

const RECENT_KEY = ["exports", "recent"] as const;

export function useRecentExports() {
  return useQuery({
    queryKey: RECENT_KEY,
    queryFn: () => apiGet<RecentExport[]>("/exports/recent"),
  });
}

// The answer is a ZIP. The server names it with the date only, so the saved file gets the same name.
export function useFullExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExportInput) => {
      const file = await apiBlob("/exports/full", {
        method: "POST",
        body: input,
        accept: "application/zip",
      });
      saveFile(file, `upasthiti-export-${todayIst()}.zip`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RECENT_KEY }),
  });
}
