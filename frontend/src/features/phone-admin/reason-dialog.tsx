// A confirmation window that asks for a reason (3 to 300 characters) and runs one change. Every
// phone-attendance change needs a reason because it is saved in the audit log (spec M4b §4.12).
import { Loader2 } from "lucide-react";
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

export const REASON_MIN = 3;
export const REASON_MAX = 300;

export function ReasonDialog({
  title,
  description,
  confirmLabel,
  danger,
  extraValid = true,
  extra,
  effects,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  /** False while an extra field (the end date) is not valid. */
  extraValid?: boolean;
  extra?: React.ReactNode;
  /** The things that happen, one line each. */
  effects?: string[];
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const length = reason.trim().length;
  const reasonValid = length >= REASON_MIN && length <= REASON_MAX;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {effects && effects.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        ) : null}
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reasonValid && extraValid) void submit();
          }}
        >
          {error ? (
            <Alert tone="danger">
              <span>{describeError(error, t)}</span>
            </Alert>
          ) : null}
          {extra}
          <Field
            id="phone-reason"
            label={t("phoneAdmin.reason.label")}
            hint={t("phoneAdmin.reason.hint")}
            error={length > 0 && !reasonValid ? t("phoneAdmin.reason.error") : undefined}
          >
            <Textarea
              id="phone-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </Field>
          <p className="text-right text-xs text-muted-foreground">
            {length} / {REASON_MAX}
          </p>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              disabled={!reasonValid || !extraValid || saving}
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {saving ? t("phoneAdmin.saving") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
