// Server data and actions for QR cards: the cards list, an employee's cards, issue, revoke,
// change the end date, bulk actions, test cards and opening card PDFs (spec §5.1).
//
// Reading is for all roles (a Plant Head sees their own plant); every change is for the Super
// Admin only, and the server checks that again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiBlob, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type CardState = "none" | "active" | "expiring" | "not_yet_valid" | "expired" | "revoked";
// Why a card was revoked. "replaced" is set by the server when a new card is issued.
export type RevokeKind = "lost" | "damaged" | "left" | "other";
export type PrintLayout = "a4_sheet" | "single_cards";

type PlantBrief = { id: string; name: string; code: string };

export type Card = {
  id: string;
  kind: "employee" | "test";
  serial: string;
  label: string | null; // test cards only
  state: Exclude<CardState, "none">;
  valid_from: string;
  valid_until: string;
  issued_at: string;
  issued_by: string;
  note: string | null;
  print_count: number;
  last_printed_at: string | null;
  printed_plant: PlantBrief | null;
  // The employee has moved plants since the card was printed: reprint advised.
  reprint_needed: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_kind: RevokeKind | "replaced" | null;
  revoke_reason: string | null;
  last_used_at: string | null;
};

export type CardEmployee = {
  id: string;
  code: string;
  name: string;
  type: "permanent" | "temporary";
  plant: PlantBrief;
  contractor: { id: string; name: string } | null;
  category: { id: string; name: string };
  punch_method: "face" | "qr";
};

export type CardRow = { employee: CardEmployee; card: Card | null };

export type CardFilters = {
  plant_id?: string;
  type?: "permanent" | "temporary";
  punch_method?: "face" | "qr";
  contractor_id?: string;
  category_id?: string;
  state?: CardState;
  printed?: boolean;
  reprint_needed?: boolean;
  q?: string;
  page: number;
  page_size?: number;
};

export type IssueInput = { valid_from?: string; valid_until?: string; note?: string };
export type IssueResult = { card: Card; replaced_card: Card | null };

export type BulkSkipped = {
  code: string; // why: EMPLOYEE_NOT_QR, QR_CARD_EXISTS, EMPLOYEE_LEFT, QR_CARD_REVOKED, ...
  employee_code: string | null;
  card_serial: string | null;
};
export type BulkResult = { done: number; skipped: BulkSkipped[] };

export const MAX_BULK = 500;
export const MAX_PRINT = 200;
const QR_CARDS_KEY = ["qr-cards"];

export function useQrCards(filters: CardFilters) {
  return useQuery({
    queryKey: [...QR_CARDS_KEY, "list", filters],
    queryFn: () => apiGet<Page<CardRow>>(`/qr-cards${queryString({ page_size: 50, ...filters })}`),
    // Keep the old page on screen while the next one loads (no jumping table).
    placeholderData: (previous) => previous,
  });
}

export function useEmployeeCards(employeeId: string) {
  return useQuery({
    queryKey: [...QR_CARDS_KEY, "employee", employeeId],
    queryFn: () => apiGet<{ cards: Card[] }>(`/employees/${employeeId}/qr-cards`),
    select: (data) => data.cards,
  });
}

/** Cards that end soon (the dashboard card and the menu badge). Super Admin only. */
export function useExpiringCount(enabled: boolean) {
  return useQuery({
    queryKey: [...QR_CARDS_KEY, "expiring-count"],
    queryFn: () => apiGet<{ count: number; days: number }>("/qr-cards/expiring-count"),
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function useTestCards(enabled: boolean) {
  return useQuery({
    queryKey: [...QR_CARDS_KEY, "test-cards"],
    queryFn: () => apiGet<Card[]>("/qr-test-cards"),
    enabled,
  });
}

// Every change refreshes all card data (lists, panels, the ending-soon count).
function useRefreshCards() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: QR_CARDS_KEY });
}

export function useIssueCard(employeeId: string) {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: IssueInput) =>
      apiPost<IssueResult>(`/employees/${employeeId}/qr-cards`, input),
    onSuccess: refresh,
  });
}

export function useRevokeCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: { cardId: string; kind: RevokeKind; reason: string }) =>
      apiPost<Card>(`/qr-cards/${input.cardId}/revoke`, { kind: input.kind, reason: input.reason }),
    onSuccess: refresh,
  });
}

export function useChangeValidUntil() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: { cardId: string; valid_until: string; reason: string }) =>
      apiPatch<Card>(`/qr-cards/${input.cardId}`, {
        valid_until: input.valid_until,
        reason: input.reason,
      }),
    onSuccess: refresh,
  });
}

export function useBulkIssue() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: { employee_ids: string[]; valid_until?: string; reason: string }) =>
      apiPost<BulkResult>("/qr-cards/bulk", { action: "issue", ...input }),
    onSuccess: refresh,
  });
}

export function useBulkRevoke() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: { card_ids: string[]; kind: RevokeKind; reason: string }) =>
      apiPost<BulkResult>("/qr-cards/bulk", { action: "revoke", ...input }),
    onSuccess: refresh,
  });
}

export function useCreateTestCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (label: string) => apiPost<Card>("/qr-test-cards", { label }),
    onSuccess: refresh,
  });
}

export function useRevokeTestCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: { cardId: string; reason: string }) =>
      apiPost<Card>(`/qr-test-cards/${input.cardId}/revoke`, { reason: input.reason }),
    onSuccess: refresh,
  });
}

// --- Printing ---------------------------------------------------------------------------------

/** The PDF of one card (one CR80 page). */
export const fetchCardPdf = (cardId: string) =>
  apiBlob(`/qr-cards/${cardId}/card.pdf`, { method: "GET" });

/** The PDF of many cards, on A4 sheets of ten or one card per page. */
export const fetchCardsPdf = (cardIds: string[], layout: PrintLayout) =>
  apiBlob("/qr-cards/print", { method: "POST", body: { card_ids: cardIds, layout } });

/**
 * Shows a PDF in a new browser tab.
 *
 * The tab is opened first, straight from the click, because a browser blocks a tab that is
 * opened later from an answer that arrives after a delay. If the browser still refuses, the
 * file is downloaded instead. A printed card is a working card, so nothing is kept here: the
 * address of the file is dropped after a minute.
 */
export async function openPdfInNewTab(makePdf: () => Promise<Blob>, filename: string) {
  const tab = window.open("", "_blank");
  let address: string;
  try {
    address = URL.createObjectURL(await makePdf());
  } catch (error) {
    tab?.close();
    throw error;
  }
  if (tab) {
    tab.location.href = address;
  } else {
    const link = document.createElement("a");
    link.href = address;
    link.download = filename;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

/**
 * Printing from a button: opens the tab at once (inside the click) and shows the PDF in it.
 * `pending` is true while the PDF is being made; `error` holds a failure for the screen to show.
 * Printing counts, so the card data is refreshed afterwards.
 */
export function usePdfPrinting() {
  const refresh = useRefreshCards();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const print = async (makePdf: () => Promise<Blob>, filename: string) => {
    setPending(true);
    setError(null);
    try {
      await openPdfInNewTab(makePdf, filename);
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
      await refresh();
    }
  };
  return { print, pending, error, clearError: () => setError(null) };
}
