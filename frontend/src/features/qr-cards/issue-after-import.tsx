// "Issue and print cards for these N employees" (F-38, spec §4.12): the follow-up after an Excel
// import, for the Super Admin only. It offers cards to the people who punch by QR card (the ones
// the import answer names); people who punch by face are left out. Used on the import result and
// on an approved import request. Issuing goes through the normal bulk issue, so every card is
// audited, and printing is the normal PDF (in parts of 200).
import { CircleCheck, IdCard, Info, Loader2, QrCode, ScanFace, SkipForward } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
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
import { formatDate } from "@/lib/format";
import { inParts } from "./bulk-plan";
import { PrintNewCards } from "./print-new-cards";
import { MAX_BULK, useBulkIssue } from "./use-qr-cards";

const MIN_REASON = 3;

type Issued = { done: number; skippedCount: number; cardIds: string[] };

type Props = {
  // The new people who punch by QR card (from the import answer).
  qrEmployeeIds: string[];
  // Everyone the import created, so the people who punch by face can be counted.
  totalCreated: number;
};

export function IssueCardsAfterImport({ qrEmployeeIds, totalCreated }: Props) {
  const { t } = useTranslation();
  const bulkIssue = useBulkIssue();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState(() =>
    t("qrCards.afterImport.defaultReason", { date: formatDate(new Date()) }),
  );
  const [issued, setIssued] = useState<Issued | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const faceCount = Math.max(0, totalCreated - qrEmployeeIds.length);

  if (qrEmployeeIds.length === 0) {
    return (
      <Alert tone="info" className="text-left">
        <ScanFace aria-hidden />
        <span>{t("qrCards.afterImport.noQr", { count: totalCreated })}</span>
      </Alert>
    );
  }

  // The server takes at most 500 people per request, so a big import is issued in parts. Each
  // part is one transaction; a part that fails stops the rest and nothing is printed twice.
  const issueAll = async () => {
    setFailure(null);
    const total: Issued = { done: 0, skippedCount: 0, cardIds: [] };
    try {
      for (const part of inParts(qrEmployeeIds, MAX_BULK)) {
        const outcome = await bulkIssue.mutateAsync({ employee_ids: part, reason: reason.trim() });
        total.done += outcome.done;
        total.skippedCount += outcome.skipped.length;
        total.cardIds.push(...outcome.card_ids);
      }
    } catch (error) {
      setFailure(error);
      // Cards already made stay made: show them, so they can still be printed.
      if (total.cardIds.length === 0) return;
    }
    setDialogOpen(false);
    setIssued(total);
  };

  if (issued) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-4 text-left">
        <p className="flex items-center gap-2 font-bold">
          <IdCard className="size-5 text-success" aria-hidden />
          {t("qrCards.afterImport.issuedTitle", { count: issued.done })}
        </p>
        <p className="text-sm text-muted-foreground">
          {faceCount > 0 ? `${t("qrCards.afterImport.issuedFace", { count: faceCount })} ` : ""}
          {issued.skippedCount > 0
            ? `${t("qrCards.bulk.skippedNote", { count: issued.skippedCount })} `
            : ""}
          {t("qrCards.afterImport.issuedText")}
        </p>
        {failure ? (
          <Alert tone="danger">
            <span>{describeError(failure, t)}</span>
          </Alert>
        ) : null}
        <PrintNewCards cardIds={issued.cardIds} />
        <Link
          to="/admin/qr-cards?printed=no"
          className="inline-flex text-sm font-semibold text-primary underline"
        >
          {t("qrCards.afterImport.goToCards")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/25 bg-primary-soft p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <QrCode className="size-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="font-bold">{t("qrCards.afterImport.title")}</p>
          <p className="text-sm">
            {t("qrCards.afterImport.text", { qr: qrEmployeeIds.length, face: faceCount })}
          </p>
        </div>
      </div>
      <Button onClick={() => setDialogOpen(true)}>
        <IdCard aria-hidden />
        {t("qrCards.afterImport.button", { count: qrEmployeeIds.length })}
      </Button>

      {dialogOpen ? (
        <Dialog open onOpenChange={(open) => !open && setDialogOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogTitle>
              {t("qrCards.afterImport.dialogTitle", { count: qrEmployeeIds.length })}
            </DialogTitle>
            <DialogDescription>{t("qrCards.afterImport.dialogText")}</DialogDescription>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                issueAll();
              }}
            >
              {failure ? (
                <Alert tone="danger">
                  <span>{describeError(failure, t)}</span>
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-lg border bg-success-soft p-3">
                  <CircleCheck className="size-5 text-success" aria-hidden />
                  <span className="tnum text-2xl font-bold">{qrEmployeeIds.length}</span>
                  <span className="text-sm">{t("qrCards.bulk.issue.willGet")}</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border bg-muted p-3">
                  <SkipForward className="size-5 text-muted-foreground" aria-hidden />
                  <span className="tnum text-2xl font-bold">{faceCount}</span>
                  <span className="text-sm">{t("qrCards.afterImport.faceLeftOut")}</span>
                </div>
              </div>
              <Field
                id="import-cards-reason"
                label={t("common.reason")}
                hint={t("common.reasonExplain")}
              >
                <Textarea
                  id="import-cards-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("qrCards.afterImport.printNote", { max: 200 })}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={reason.trim().length < MIN_REASON || bulkIssue.isPending}
                >
                  {bulkIssue.isPending ? <Loader2 className="animate-spin" /> : null}
                  {t("qrCards.afterImport.submit", { count: qrEmployeeIds.length })}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
