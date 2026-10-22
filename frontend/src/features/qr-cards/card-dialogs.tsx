// The three dialogs of a card: issue (or replace), revoke, and change the end date. Only the
// Super Admin sees the buttons that open them; the server refuses everyone else anyway.
import { Loader2, Printer, TriangleAlert } from "lucide-react";
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
import { Input, Textarea } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { useSettings } from "@/features/settings/use-settings";
import { addDays, addMonths, defaultValidUntil } from "@/lib/dates";
import { formatDate, todayIst } from "@/lib/format";
import {
  type Card,
  fetchCardPdf,
  type IssueResult,
  type RevokeKind,
  useChangeValidUntil,
  useIssueCard,
  usePdfPrinting,
  useRevokeCard,
} from "./use-qr-cards";

const MIN_REASON = 3;
const MAX_DAYS_AHEAD = 60;
// Used only until the settings have loaded; the real value is the Super Admin's setting.
const FALLBACK_VALIDITY_MONTHS = 2;
const REVOKE_KINDS: RevokeKind[] = ["lost", "damaged", "left", "other"];

type Person = { id: string; name: string };

/** How many months a new card lasts by default (setting `qr_card_default_validity_months`). */
function useDefaultValidityMonths(): number {
  const settings = useSettings();
  return Number(
    settings.data?.settings.find((setting) => setting.key === "qr_card_default_validity_months")
      ?.value ?? FALLBACK_VALIDITY_MONTHS,
  );
}

// --- Issue or replace -------------------------------------------------------------------------

type IssueDialogProps = {
  employee: Person;
  // The card that stops working when the new one is issued (null when there is none).
  replacing: Card | null;
  onClose: () => void;
};

export function IssueCardDialog({ employee, replacing, onClose }: IssueDialogProps) {
  const { t } = useTranslation();
  const issue = useIssueCard(employee.id);
  const printing = usePdfPrinting();
  const today = todayIst();
  const months = useDefaultValidityMonths();
  const [validFrom, setValidFrom] = useState(today);
  // null = follow the default (start + months - 1 day); a typed date replaces it.
  const [typedUntil, setTypedUntil] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const validUntil = typedUntil ?? defaultValidUntil(validFrom, months);

  if (issued) {
    const card = issued.card;
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>{t("qrCards.dialog.issue.doneTitle", { serial: card.serial })}</DialogTitle>
          <DialogDescription>
            {t("qrCards.dialog.issue.doneText", {
              from: formatDate(card.valid_from),
              until: formatDate(card.valid_until),
            })}
          </DialogDescription>
          {printing.error ? (
            <Alert tone="danger" className="mt-4">
              <span>{describeError(printing.error, t)}</span>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button
              disabled={printing.pending}
              onClick={() => printing.print(() => fetchCardPdf(card.id), `card-${card.serial}.pdf`)}
            >
              {printing.pending ? <Loader2 className="animate-spin" /> : <Printer aria-hidden />}
              {t("qrCards.dialog.issue.printNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("qrCards.dialog.issue.title")}</DialogTitle>
        <DialogDescription>
          {replacing
            ? t("qrCards.dialog.issue.subtitleReplace", { name: employee.name })
            : t("qrCards.dialog.issue.subtitleNew", { name: employee.name })}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            issue.mutate(
              { valid_from: validFrom, valid_until: validUntil, note: note.trim() || undefined },
              { onSuccess: setIssued },
            );
          }}
        >
          {replacing ? (
            <Alert tone="warning">
              <TriangleAlert aria-hidden />
              <span>
                <b>{t("qrCards.dialog.issue.replaceTitle", { serial: replacing.serial })}</b>{" "}
                {t("qrCards.dialog.issue.replaceText")}
              </span>
            </Alert>
          ) : null}
          {issue.isError ? (
            <Alert tone="danger">
              <span>{describeError(issue.error, t)}</span>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="card-valid-from"
              label={t("qrCards.dialog.issue.validFrom")}
              hint={t("qrCards.dialog.issue.validFromHint", { days: MAX_DAYS_AHEAD })}
            >
              <Input
                id="card-valid-from"
                type="date"
                required
                min={today}
                max={addDays(today, MAX_DAYS_AHEAD)}
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </Field>
            <Field
              id="card-valid-until"
              label={t("qrCards.dialog.issue.validUntil")}
              hint={t("qrCards.dialog.issue.validUntilHint", { months, count: months })}
            >
              <Input
                id="card-valid-until"
                type="date"
                required
                min={validFrom}
                value={validUntil}
                onChange={(event) => setTypedUntil(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setTypedUntil(defaultValidUntil(validFrom, months))}
              >
                {t("qrCards.dialog.issue.plusMonths", { months, count: months })}
              </Button>
            </Field>
          </div>
          <Field
            id="card-note"
            label={`${t("qrCards.dialog.issue.note")} (${t("qrCards.dialog.issue.optional")})`}
          >
            <Textarea
              id="card-note"
              maxLength={300}
              placeholder={t("qrCards.dialog.issue.notePlaceholder")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={issue.isPending || !validFrom || !validUntil}>
              {issue.isPending ? <Loader2 className="animate-spin" /> : null}
              {replacing
                ? t("qrCards.dialog.issue.submitReplace")
                : t("qrCards.dialog.issue.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Revoke -----------------------------------------------------------------------------------

export function RevokeCardDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useTranslation();
  const revoke = useRevokeCard();
  const [kind, setKind] = useState<RevokeKind>("lost");
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MIN_REASON;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("qrCards.dialog.revoke.title", { serial: card.serial })}</DialogTitle>
        <DialogDescription>{t("qrCards.dialog.revoke.warning")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            revoke.mutate(
              { cardId: card.id, kind, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t("qrCards.dialog.revoke.done", { serial: card.serial }));
                  onClose();
                },
              },
            );
          }}
        >
          {revoke.isError ? (
            <Alert tone="danger">
              <span>{describeError(revoke.error, t)}</span>
            </Alert>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">
              {t("qrCards.dialog.revoke.kind")}
            </legend>
            {REVOKE_KINDS.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="revoke-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="size-4"
                />
                {t(`qrCards.revokeKind.${option}`)}
              </label>
            ))}
          </fieldset>
          <Field id="revoke-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || revoke.isPending}>
              {revoke.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("qrCards.dialog.revoke.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Change the end date ----------------------------------------------------------------------

export function ChangeValidUntilDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t } = useTranslation();
  const change = useChangeValidUntil();
  const today = todayIst();
  const months = useDefaultValidityMonths();
  const [validUntil, setValidUntil] = useState(card.valid_until);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MIN_REASON && validUntil >= today;
  // "Extend" always counts from the later of today and the current end.
  const extendFrom = card.valid_until > today ? card.valid_until : today;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("qrCards.dialog.changeEnd.title")}</DialogTitle>
        <DialogDescription>
          {t("qrCards.dialog.changeEnd.current", {
            serial: card.serial,
            date: formatDate(card.valid_until),
          })}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate(
              { cardId: card.id, valid_until: validUntil, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t("qrCards.dialog.changeEnd.done"));
                  onClose();
                },
              },
            );
          }}
        >
          {change.isError ? (
            <Alert tone="danger">
              <span>{describeError(change.error, t)}</span>
            </Alert>
          ) : null}
          <Field
            id="card-new-end"
            label={t("qrCards.dialog.changeEnd.newDate")}
            hint={t("qrCards.dialog.changeEnd.hint")}
          >
            <Input
              id="card-new-end"
              type="date"
              required
              min={today}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setValidUntil(today)}>
                {t("qrCards.dialog.changeEnd.endToday")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setValidUntil(addMonths(extendFrom, months))}
              >
                {t("qrCards.dialog.changeEnd.extend", { months, count: months })}
              </Button>
            </div>
          </Field>
          <Field id="card-end-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="card-end-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || change.isPending}>
              {change.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("qrCards.dialog.changeEnd.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
