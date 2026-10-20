// The three bulk dialogs of the QR cards list: issue cards, revoke cards and print cards. Each
// first says what will happen to every selected person, then does it. People who cannot be done
// (they punch by face, already have a card, ...) are skipped and listed, never failed.
import { CircleCheck, Loader2, Printer, SkipForward, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { ApiError } from "@/lib/api-client";
import { todayIst } from "@/lib/format";
import { doable, type Planned, planCardAction, planIssue, skipped } from "./bulk-plan";
import { PrintNewCards } from "./print-new-cards";
import {
  type BulkResult,
  type CardRow,
  fetchCardsPdf,
  MAX_BULK,
  MAX_PRINT,
  type PrintLayout,
  type RevokeKind,
  useBulkIssue,
  useBulkRevoke,
  usePdfPrinting,
} from "./use-qr-cards";

const MIN_REASON = 3;
const REVOKE_KINDS: RevokeKind[] = ["lost", "damaged", "left", "other"];
const SHOWN_SKIPPED = 6;

type BulkDialogProps = {
  rows: CardRow[];
  onClose: () => void;
  // Called when the action is finished, so the page can clear its selection.
  onDone: () => void;
};

function Tile({
  icon,
  tone,
  count,
  label,
}: {
  icon: React.ReactNode;
  tone: string;
  count: number;
  label: string;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${tone}`}>
      {icon}
      <span className="tnum text-2xl font-bold">{count}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function SkippedList({ items }: { items: Planned[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {items.slice(0, SHOWN_SKIPPED).map(({ row, skip }) => (
        <li key={row.employee.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="code font-bold">{row.employee.code}</span>
          <span>{row.employee.name}</span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            <SkipForward className="size-3.5" aria-hidden />
            {t(`qrCards.skip.${skip}`, { serial: row.card?.serial ?? "" })}
          </span>
        </li>
      ))}
      {items.length > SHOWN_SKIPPED ? (
        <li className="px-3 py-2 text-muted-foreground">
          {t("qrCards.bulk.andMore", { count: items.length - SHOWN_SKIPPED })}
        </li>
      ) : null}
    </ul>
  );
}

// What the server skipped (it decides again): code, person and why.
function ServerSkippedTable({ result, rows }: { result: BulkResult; rows: CardRow[] }) {
  const { t } = useTranslation();
  if (result.skipped.length === 0) return null;
  const nameOf = (code: string | null) =>
    rows.find((row) => row.employee.code === code)?.employee.name ?? "";
  return (
    <div className="space-y-2">
      <Alert tone="warning">
        <SkipForward aria-hidden />
        <span>{t("qrCards.bulk.skippedNote", { count: result.skipped.length })}</span>
      </Alert>
      <ul className="divide-y rounded-lg border text-sm">
        {result.skipped.map((item) => (
          <li
            key={`${item.employee_code}-${item.card_serial}-${item.code}`}
            className="flex flex-wrap items-center gap-2 px-3 py-2"
          >
            <span className="code font-bold">{item.employee_code ?? item.card_serial ?? "–"}</span>
            <span>{nameOf(item.employee_code)}</span>
            <span className="ml-auto text-muted-foreground">
              {t(`qrCards.skip.${item.code}`, { serial: item.card_serial ?? "" })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Issue cards ------------------------------------------------------------------------------

export function BulkIssueDialog({ rows, onClose, onDone }: BulkDialogProps) {
  const { t } = useTranslation();
  const issue = useBulkIssue();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const plan = planIssue(rows);
  const toIssue = doable(plan);
  const toSkip = skipped(plan);
  const tooMany = rows.length > MAX_BULK;

  const finish = () => {
    onDone();
    onClose();
  };

  if (result) {
    return (
      <Dialog open onOpenChange={(open) => !open && finish()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{t("qrCards.bulk.issue.resultTitle", { count: result.done })}</DialogTitle>
          <DialogDescription>{t("qrCards.bulk.issue.resultText")}</DialogDescription>
          <div className="mt-4 space-y-4">
            <ServerSkippedTable result={result} rows={rows} />
            <PrintNewCards cardIds={result.card_ids} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={finish}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t("qrCards.bulk.issue.title", { count: rows.length })}</DialogTitle>
        <DialogDescription>{t("qrCards.bulk.issue.description")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            issue.mutate(
              { employee_ids: rows.map((row) => row.employee.id), reason: reason.trim() },
              { onSuccess: setResult },
            );
          }}
        >
          {tooMany ? (
            <Alert tone="danger">
              <span>{t("qrCards.bulk.tooMany", { max: MAX_BULK })}</span>
            </Alert>
          ) : null}
          {issue.isError ? (
            <Alert tone="danger">
              <span>{describeError(issue.error, t)}</span>
            </Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile
              icon={<CircleCheck className="size-5 text-success" aria-hidden />}
              tone="bg-success-soft"
              count={toIssue.length}
              label={t("qrCards.bulk.issue.willGet")}
            />
            <Tile
              icon={<SkipForward className="size-5 text-muted-foreground" aria-hidden />}
              tone="bg-muted"
              count={toSkip.length}
              label={t("qrCards.bulk.willSkip")}
            />
          </div>
          <SkippedList items={toSkip} />
          <Field id="bulk-issue-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="bulk-issue-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                toIssue.length === 0 ||
                tooMany ||
                reason.trim().length < MIN_REASON ||
                issue.isPending
              }
            >
              {issue.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("qrCards.bulk.issue.submit", { count: toIssue.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Revoke cards -----------------------------------------------------------------------------

export function BulkRevokeDialog({ rows, onClose, onDone }: BulkDialogProps) {
  const { t } = useTranslation();
  const revoke = useBulkRevoke();
  const [kind, setKind] = useState<RevokeKind>("other");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const plan = planCardAction(rows);
  const toRevoke = doable(plan);
  const toSkip = skipped(plan);
  const tooMany = rows.length > MAX_BULK;

  const finish = () => {
    onDone();
    onClose();
  };

  if (result) {
    return (
      <Dialog open onOpenChange={(open) => !open && finish()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{t("qrCards.bulk.revoke.resultTitle", { count: result.done })}</DialogTitle>
          <DialogDescription>{t("qrCards.bulk.revoke.resultText")}</DialogDescription>
          <div className="mt-4">
            <ServerSkippedTable result={result} rows={rows} />
          </div>
          <DialogFooter>
            <Button onClick={finish}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t("qrCards.bulk.revoke.title", { count: toRevoke.length })}</DialogTitle>
        <DialogDescription>
          {t("qrCards.bulk.revoke.description", {
            total: rows.length,
            skipped: toSkip.length,
          })}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            revoke.mutate(
              {
                card_ids: toRevoke.map((item) => item.row.card?.id ?? ""),
                kind,
                reason: reason.trim(),
              },
              {
                onSuccess: (outcome) => {
                  if (outcome.skipped.length === 0) {
                    toast.success(t("qrCards.bulk.revoke.done", { count: outcome.done }));
                    finish();
                  } else {
                    setResult(outcome);
                  }
                },
              },
            );
          }}
        >
          {tooMany ? (
            <Alert tone="danger">
              <span>{t("qrCards.bulk.tooMany", { max: MAX_BULK })}</span>
            </Alert>
          ) : null}
          {revoke.isError ? (
            <Alert tone="danger">
              <span>{describeError(revoke.error, t)}</span>
            </Alert>
          ) : null}
          <SkippedList items={toSkip} />
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">
              {t("qrCards.dialog.revoke.kind")}
            </legend>
            {REVOKE_KINDS.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="bulk-revoke-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="size-4"
                />
                {t(`qrCards.revokeKind.${option}`)}
              </label>
            ))}
          </fieldset>
          <Field
            id="bulk-revoke-reason"
            label={t("common.reason")}
            hint={t("common.reasonExplain")}
          >
            <Textarea
              id="bulk-revoke-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={
                toRevoke.length === 0 ||
                tooMany ||
                reason.trim().length < MIN_REASON ||
                revoke.isPending
              }
            >
              {revoke.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("qrCards.bulk.revoke.submit", { count: toRevoke.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Print cards ------------------------------------------------------------------------------

export function PrintCardsDialog({ rows, onClose, onDone }: BulkDialogProps) {
  const { t } = useTranslation();
  const printing = usePdfPrinting();
  const [layout, setLayout] = useState<PrintLayout>("a4_sheet");
  const plan = planCardAction(rows);
  const toPrint = doable(plan);
  const toSkip = skipped(plan);
  const tooMany = toPrint.length > MAX_PRINT;
  const revokedSerials =
    printing.error instanceof ApiError && printing.error.code === "QR_CARD_REVOKED"
      ? ((printing.error.details.serials as string[] | undefined) ?? [])
      : [];

  const print = async () => {
    const ids = toPrint.map((item) => item.row.card?.id ?? "");
    const shown = await printing.print(
      () => fetchCardsPdf(ids, layout),
      `cards-${todayIst()}-${ids.length}.pdf`,
    );
    if (shown) {
      onDone();
      onClose();
    }
  };

  if (tooMany) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>{t("qrCards.print.tooManyTitle")}</DialogTitle>
          <DialogDescription>
            {t("qrCards.print.tooManyText", { count: toPrint.length })}
          </DialogDescription>
          <Alert tone="warning" className="mt-4">
            <TriangleAlert aria-hidden />
            <span>{t("qrCards.print.tooManyTip", { max: MAX_PRINT })}</span>
          </Alert>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t("qrCards.print.title", { count: toPrint.length })}</DialogTitle>
        <DialogDescription>{t("qrCards.print.description")}</DialogDescription>
        <div className="mt-4 space-y-4">
          {printing.error ? (
            <Alert tone="danger">
              <span>
                {describeError(printing.error, t)}
                {revokedSerials.length > 0 ? ` ${revokedSerials.join(", ")}` : ""}
              </span>
            </Alert>
          ) : null}
          {toSkip.length > 0 ? (
            <>
              <Alert tone="info">
                <span>{t("qrCards.print.leftOut", { count: toSkip.length })}</span>
              </Alert>
              <SkippedList items={toSkip} />
            </>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">{t("qrCards.print.layout")}</legend>
            {(["a4_sheet", "single_cards"] as const).map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="radio"
                  name="print-layout"
                  value={option}
                  checked={layout === option}
                  onChange={() => setLayout(option)}
                  className="mt-1 size-4"
                />
                <span>
                  <b className="block">{t(`qrCards.print.layouts.${option}.title`)}</b>
                  <span className="text-muted-foreground">
                    {t(`qrCards.print.layouts.${option}.text`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-[13px] text-muted-foreground">{t("qrCards.print.note")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={toPrint.length === 0 || printing.pending} onClick={print}>
            {printing.pending ? <Loader2 className="animate-spin" /> : <Printer aria-hidden />}
            {t("qrCards.print.submit", { count: toPrint.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
