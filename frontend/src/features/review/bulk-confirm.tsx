// Bulk confirm of clean outside-work phone punches (M4b F-76, spec §4.13, design gate P3 screen 4).
// With the "Phone" filter on the "To check" tab, a punch whose only flag is "Outside plant" gets a
// check box. A bar at the bottom says how many are selected and offers "Confirm selected (n)" with
// one optional note. The server confirms each punch on its own, so one failure never undoes the
// others; the screen then says in words which ones need a single review.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { apiPost } from "@/lib/api-client";
import { PUNCHES_KEY } from "../punches/use-punches";
import { REVIEW_KEY, type ReviewListItem } from "./use-review";

export const BULK_MAX = 100;
const NOTE_MAX = 300;

export type BulkResult = { punch_id: string; ok: boolean; error_code?: string };

export function useBulkConfirm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      items: { punch_id: string; expected_latest_review_id: string | null }[];
      note?: string;
    }) => apiPost<{ results: BulkResult[] }>("/reviews/bulk-confirm", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEW_KEY });
      void queryClient.invalidateQueries({ queryKey: PUNCHES_KEY });
    },
  });
}

/** The check box of one row, or the lock and "Single review" for a punch that cannot be bulk. */
export function BulkCell({
  row,
  checked,
  atLimit,
  onToggle,
}: {
  row: ReviewListItem;
  checked: boolean;
  atLimit: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  if (!row.bulk_confirmable) {
    return (
      <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        {t("review.bulk.single")}
      </span>
    );
  }
  return (
    <label className="mt-1 flex min-h-11 items-center gap-2 text-sm font-semibold">
      <input
        type="checkbox"
        className="size-5"
        checked={checked}
        disabled={!checked && atLimit}
        onChange={onToggle}
      />
      {t("review.bulk.select")}
    </label>
  );
}

export function BulkBar({
  count,
  atLimit,
  onClear,
  onConfirm,
}: {
  count: number;
  atLimit: boolean;
  onClear: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t bg-foreground px-4 py-3 text-white">
      <span className="text-sm font-semibold">
        {t("review.bulk.selected", { count })}
        {atLimit ? (
          <span className="ml-2 font-normal">{t("review.bulk.limit", { max: BULK_MAX })}</span>
        ) : null}
      </span>
      <span className="flex gap-2">
        <Button variant="outline" onClick={onClear}>
          {t("review.bulk.clear")}
        </Button>
        <Button onClick={onConfirm}>{t("review.bulk.confirm", { count })}</Button>
      </span>
    </div>
  );
}

export function BulkDialog({
  rows,
  onDone,
  onClose,
}: {
  rows: ReviewListItem[];
  onDone: (results: BulkResult[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkConfirm();
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("review.bulk.dialogTitle", { count: rows.length })}</DialogTitle>
        <DialogDescription>{t("review.bulk.dialogDesc")}</DialogDescription>
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
          {rows.map((row) => (
            <li key={row.punch.id} className="flex justify-between gap-3">
              <span>{row.punch.employee?.name ?? t("review.row.unknown")}</span>
              {row.punch.employee ? (
                <span className="code text-muted-foreground">{row.punch.employee.code}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            bulk.mutate(
              {
                items: rows.map((row) => ({
                  punch_id: row.punch.id,
                  expected_latest_review_id: row.latest_review?.id ?? null,
                })),
                ...(note.trim() ? { note: note.trim() } : {}),
              },
              {
                onSuccess: (answer) => {
                  onDone(answer.results);
                  onClose();
                },
              },
            );
          }}
        >
          {bulk.isError ? (
            <Alert tone="danger">
              <span>{describeError(bulk.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="bulk-note" label={t("review.bulk.note")} hint={t("review.bulk.noteHint")}>
            <Textarea
              id="bulk-note"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={bulk.isPending}>
              {bulk.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("review.bulk.confirm", { count: rows.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
