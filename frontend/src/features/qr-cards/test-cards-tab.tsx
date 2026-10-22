// The "Test cards" tab (F-27, spec §4.6): cards a guard scans at a gate kiosk to check that it
// works ("Device OK"). A test card belongs to nobody and never makes attendance. Super Admin only:
// other roles never see this tab.
import { Loader2, Plus, Printer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card as Panel } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { formatDate, formatTime } from "@/lib/format";
import { CardStateBadge } from "./card-badges";
import {
  type Card,
  fetchCardPdf,
  useCreateTestCard,
  usePdfPrinting,
  useRevokeTestCard,
  useTestCards,
} from "./use-qr-cards";

function NewTestCardDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateTestCard();
  const [label, setLabel] = useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("qrCards.test.newTitle")}</DialogTitle>
        <DialogDescription>{t("qrCards.test.newText")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(label.trim(), {
              onSuccess: (card) => {
                toast.success(t("qrCards.test.created", { serial: card.serial }));
                onClose();
              },
            });
          }}
        >
          {create.isError ? (
            <Alert tone="danger">
              <span>{describeError(create.error, t)}</span>
            </Alert>
          ) : null}
          <Field
            id="test-card-label"
            label={t("qrCards.test.label")}
            hint={t("qrCards.test.labelHint")}
          >
            <Input
              id="test-card-label"
              value={label}
              maxLength={80}
              placeholder={t("qrCards.test.labelPlaceholder")}
              onChange={(event) => setLabel(event.target.value)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={label.trim().length === 0 || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("qrCards.test.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TestCardsTab() {
  const { t } = useTranslation();
  const cards = useTestCards(true);
  const revoke = useRevokeTestCard();
  const printing = usePdfPrinting();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Card | null>(null);

  const rows = cards.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("qrCards.test.explain")}</p>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t("qrCards.test.new")}
        </Button>
      </div>

      {cards.isError ? (
        <Alert tone="danger">
          <span>{describeError(cards.error, t)}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => cards.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}
      {printing.error ? (
        <Alert tone="danger">
          <span>{describeError(printing.error, t)}</span>
        </Alert>
      ) : null}

      <Panel className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("qrCards.test.columns.serial")}</TableHead>
              <TableHead>{t("qrCards.test.columns.label")}</TableHead>
              <TableHead>{t("qrCards.test.columns.state")}</TableHead>
              <TableHead>{t("qrCards.test.columns.lastUsed")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.isPending
              ? Array.from({ length: 3 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell className="code font-bold">{card.serial}</TableCell>
                    <TableCell>{card.label}</TableCell>
                    <TableCell>
                      <CardStateBadge state={card.state} />
                    </TableCell>
                    <TableCell className="tnum">
                      {card.last_used_at
                        ? `${formatDate(card.last_used_at)} ${formatTime(card.last_used_at)}`
                        : t("qrCards.test.never")}
                    </TableCell>
                    <TableCell>
                      {card.state === "revoked" ? null : (
                        <span className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={printing.pending}
                            onClick={() =>
                              printing.print(() => fetchCardPdf(card.id), `card-${card.serial}.pdf`)
                            }
                          >
                            <Printer aria-hidden />
                            {t("qrCards.test.print")}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRevoking(card)}>
                            {t("qrCards.panel.revoke")}
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {cards.data && rows.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">{t("qrCards.test.empty")}</p>
        ) : null}
      </Panel>

      {creating ? <NewTestCardDialog onClose={() => setCreating(false)} /> : null}
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("qrCards.test.revokeTitle", { serial: revoking?.serial ?? "" })}
        confirmLabel={t("qrCards.dialog.revoke.submit")}
        isPending={revoke.isPending}
        error={revoke.isError ? describeError(revoke.error, t) : undefined}
        onConfirm={(reason) =>
          revoking &&
          revoke.mutate(
            { cardId: revoking.id, reason },
            {
              onSuccess: () => {
                toast.success(t("qrCards.dialog.revoke.done", { serial: revoking.serial }));
                setRevoking(null);
              },
            },
          )
        }
      />
    </div>
  );
}
