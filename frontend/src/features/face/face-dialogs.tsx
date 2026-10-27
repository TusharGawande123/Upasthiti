// The two small face dialogs of the face panel: withdraw consent and delete face data (spec M3
// §4.7). Only the Super Admin sees the buttons that open them; the server refuses everyone else.
import { Loader2 } from "lucide-react";
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
import { useDeleteFaceData, useWithdrawConsent } from "./use-face";

const MIN_REASON = 3;

type Props = { employee: { id: string; name: string }; onClose: () => void };

// Withdrawing must be as easy as giving consent (DPDP): the reason is optional and pre-filled.
export function WithdrawConsentDialog({ employee, onClose }: Props) {
  const { t } = useTranslation();
  const withdraw = useWithdrawConsent(employee.id);
  const [reason, setReason] = useState(() => t("face.withdraw.defaultReason"));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("face.withdraw.title", { name: employee.name })}</DialogTitle>
        <DialogDescription>{t("face.withdraw.text")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            withdraw.mutate(reason.trim(), {
              onSuccess: () => {
                toast.success(t("face.withdraw.done", { name: employee.name }));
                onClose();
              },
            });
          }}
        >
          {withdraw.isError ? (
            <Alert tone="danger">
              <span>{describeError(withdraw.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="withdraw-reason" label={t("face.withdraw.reason")}>
            <Textarea
              id="withdraw-reason"
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={withdraw.isPending}>
              {withdraw.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("face.withdraw.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFaceDataDialog({ employee, onClose }: Props) {
  const { t } = useTranslation();
  const remove = useDeleteFaceData(employee.id);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MIN_REASON;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("face.delete.title", { name: employee.name })}</DialogTitle>
        <DialogDescription>{t("face.delete.text")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            remove.mutate(reason.trim(), {
              onSuccess: () => {
                toast.success(t("face.delete.done", { name: employee.name }));
                onClose();
              },
            });
          }}
        >
          {remove.isError ? (
            <Alert tone="danger">
              <span>{describeError(remove.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="delete-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="delete-reason"
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || remove.isPending}>
              {remove.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("face.delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
