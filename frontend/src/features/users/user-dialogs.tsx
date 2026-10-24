// Two small dialogs: ask for a reason (every user change is audited), and show a temporary
// password exactly once with a copy button.
import { Check, Copy, Loader2, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
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

const MINIMUM_REASON_LENGTH = 3;

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  isPending: boolean;
  error?: string;
  /** Something to read before giving the reason, for example the list of changes. */
  details?: ReactNode;
  onConfirm: (reason: string) => void;
};

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  isPending,
  error,
  details,
  onConfirm,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MINIMUM_REASON_LENGTH;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("common.reasonExplain")}</DialogDescription>
        <div className="mt-4 space-y-4">
          {details}
          {error ? (
            <Alert tone="danger">
              <span>{error}</span>
            </Alert>
          ) : null}
          <Field id="reason" label={t("common.reason")}>
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || isPending} onClick={() => onConfirm(reason.trim())}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TemporaryPasswordDialogProps = {
  shown: { name: string; password: string } | null;
  onClose: () => void;
};

export function TemporaryPasswordDialog({ shown, onClose }: TemporaryPasswordDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!shown) return;
    await navigator.clipboard.writeText(shown.password);
    setCopied(true);
  };

  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{t("users.temporaryPassword.title")}</DialogTitle>
        <DialogDescription>
          {t("users.temporaryPassword.description", { name: shown?.name })}
        </DialogDescription>
        <div className="mt-4 flex items-center gap-2 rounded-md border bg-muted p-3">
          <output className="code flex-1 text-xl font-semibold tracking-wider select-all">
            {shown?.password}
          </output>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
        <Alert tone="warning" className="mt-4">
          <TriangleAlert aria-hidden />
          <span>{t("users.temporaryPassword.shownOnce")}</span>
        </Alert>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
