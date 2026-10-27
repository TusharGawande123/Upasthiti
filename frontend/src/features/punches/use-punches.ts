// Server data for the punch log (spec M2 §5.3): the day's list and summary, one punch's photo,
// the photo comparison and the Excel export. Reading is for all roles (a Plant Head sees
// punches at their own plant); photos and the comparison are for the Super Admin only, and the
// server checks that again. Every photo shown is one audited view, so photos are never cached.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, apiBlob, apiGet } from "@/lib/api-client";
import { todayIst } from "@/lib/format";
import { type Page, queryString } from "@/lib/paging";

export type SnapshotState = "stored" | "purged" | "upload_failed" | "none";

export type PunchSnapshotInfo = {
  state: SnapshotState;
  is_dark: boolean | null; // Super Admin only
  expires_at: string | null;
  purged_at: string | null;
  // M3 (F-30): whether the card photo shows a face; Super Admin only, null while unchecked.
  face_found?: boolean | null;
};

export type PunchItem = {
  id: string;
  server_received_at: string;
  employee: { id: string; code: string; name: string } | null;
  // True when the card belongs to a person of another plant and the viewer may not know who.
  employee_hidden: boolean;
  plant: { id: string; name: string; code: string | null };
  kiosk: { id: string; name: string };
  method: string; // "qr" (card) or "face"
  direction: "in" | "out" | null;
  decision: "accepted" | "rejected" | "needs_code";
  reason_codes: string[];
  snapshot: PunchSnapshotInfo;
  // M3: how a face punch was decided, and the two rows of a code entry.
  match_mode?: "one_to_many" | "code" | null;
  follows_punch_id?: string | null;
  followed_by_punch_id?: string | null;
};

/** What the face check measured. Super Admin only; other roles get no such object (AC-24). */
export type PunchFaceDetail = {
  match_score: number | null;
  second_best_score: number | null;
  antispoof_score: number | null;
  yaw_degrees: number | null;
  challenge: string | null;
  model_id: string | null;
  match_mode: string | null;
  claimed_employee: { id: string; code: string; name: string } | null;
};

export type PunchDetail = PunchItem & {
  app_version: string | null;
  face: PunchFaceDetail | null;
};

export type PunchSummary = {
  accepted_in: number;
  accepted_out: number;
  rejected: number;
  dark_photos: number | null; // Super Admin only
  rejected_by_reason: Record<string, number>;
  // M3: how the accepted punches were decided, and the code and photo counts.
  face_accepted?: number;
  code_accepted?: number;
  asked_for_code?: number;
  no_face_photos?: number | null; // Super Admin only
};

export type PunchFilters = {
  date: string;
  plant_id?: string;
  decision?: "accepted" | "rejected";
  method?: "face" | "qr";
  match_mode?: "code";
  asked_for_code?: boolean;
  no_face_photo?: boolean;
  kiosk_id?: string;
  reason_code?: string;
  dark_only?: boolean;
  q?: string;
  page: number;
  page_size?: number;
};

export const PUNCHES_KEY = ["punches"] as const;
const REFRESH_EVERY_MS = 30_000;

export const isToday = (date: string) => date === todayIst();

export function usePunches(filters: PunchFilters) {
  return useQuery({
    queryKey: [...PUNCHES_KEY, "list", filters],
    queryFn: () => apiGet<Page<PunchItem>>(`/punches${queryString({ page_size: 50, ...filters })}`),
    placeholderData: (previous) => previous,
    // While looking at today the list stays fresh by itself (spec §4.10).
    refetchInterval: isToday(filters.date) ? REFRESH_EVERY_MS : false,
  });
}

export function usePunchSummary(date: string, plantId: string | undefined) {
  return useQuery({
    queryKey: [...PUNCHES_KEY, "summary", date, plantId ?? ""],
    queryFn: () =>
      apiGet<PunchSummary>(`/punches/summary${queryString({ date, plant_id: plantId })}`),
    placeholderData: (previous) => previous,
    refetchInterval: isToday(date) ? REFRESH_EVERY_MS : false,
  });
}

export function usePunchDetail(punchId: string | null) {
  return useQuery({
    queryKey: [...PUNCHES_KEY, "detail", punchId],
    queryFn: () => apiGet<PunchDetail>(`/punches/${punchId}`),
    enabled: punchId !== null,
  });
}

export type Comparison = { current: PunchItem; earlier: PunchItem[] };

export function useComparison(punchId: string | null) {
  return useQuery({
    queryKey: [...PUNCHES_KEY, "compare", punchId],
    queryFn: () => apiGet<Comparison>(`/punches/${punchId}/compare`),
    enabled: punchId !== null,
    gcTime: 0,
  });
}

export type PhotoState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; code: string };

/**
 * Loads one punch photo as a picture. Each load is one audited view on the server, so it runs
 * once per photo shown (not on every window focus) and the picture is released afterwards.
 */
export function usePunchPhoto(punchId: string): PhotoState {
  const [state, setState] = useState<PhotoState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    apiBlob(`/punches/${punchId}/snapshot`, { method: "GET", accept: "image/jpeg" })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            code: error instanceof ApiError ? error.code : "NETWORK_ERROR",
          });
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [punchId]);

  return state;
}

/** Downloads the day as a spreadsheet: same filters as the list, no photos. */
export async function downloadPunchExport(filters: PunchFilters): Promise<void> {
  const { page: _page, page_size: _size, ...forExport } = filters;
  const blob = await apiBlob(`/punches/export.xlsx${queryString(forExport)}`, {
    method: "GET",
    accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `punches-${filters.date}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
