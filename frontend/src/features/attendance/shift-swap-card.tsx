// The one-day shift swap card of the employee's Attendance tab (F-58, spec M5 §4.5). Everyone who
// can read the person sees the swaps; only the Super Admin makes or cancels one. A swap can be
// cancelled only before its day starts; the server decides that and its message is shown here.
import { Repeat, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { useShifts } from "@/features/plants/use-plants";
import { todayIst } from "@/lib/format";
import { formatDay } from "./attendance-format";
import { type SwapLine, useCancelSwap, useCreateSwap, useShiftSwaps } from "./use-day-detail";

const REASON_MIN = 3;
const REASON_MAX = 300;

function reasonIsValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= REASON_MIN && length <= REASON_MAX;
}

function NewSwapDialog({
  employeeId,
  plantId,
  onClose,
}: {
  employeeId: string;
  plantId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const shifts = useShifts(plantId);
  const create = useCreateSwap(employeeId);
  const [date, setDate] = useState(todayIst());
  const [shiftId, setShiftId] = useState("");
  const [reason, setReason] = useState("");
  const activeShifts = shifts.data?.filter((shift) => shift.is_active) ?? [];
  const canSave =
    date >= todayIst() && shiftId !== "" && reasonIsValid(reason) && !create.isPending;

  const save = () =>
    create.mutate(
      { date, shift_id: shiftId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t("attendance.swap.created"));
          onClose();
        },
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("attendance.swap.title")}</DialogTitle>
        <DialogDescription>{t("attendance.swap.explain")}</DialogDescription>
        <div className="mt-4 space-y-4">
          <Field id="swap-date" label={t("attendance.swap.date")}>
            <Input
              id="swap-date"
              type="date"
              min={todayIst()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field id="swap-shift" label={t("attendance.swap.shift")}>
            <Select
              id="swap-shift"
              value={shiftId}
              onChange={(event) => setShiftId(event.target.value)}
            >
              <option value="">{t("attendance.swap.chooseShift")}</option>
              {activeShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="swap-reason"
            label={t("attendance.swap.reason")}
            hint={t("corrections.reasonRange")}
          >
            <Textarea
              id="swap-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {create.isError ? <Alert tone="danger">{describeError(create.error, t)}</Alert> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {t("attendance.swap.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelSwapDialog({ swap, onClose }: { swap: SwapLine; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelSwap();
  const [reason, setReason] = useState("");
  const run = () =>
    cancel.mutate(
      { swapId: swap.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t("attendance.swap.cancelled"));
          onClose();
        },
      },
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("attendance.swap.cancel")}</DialogTitle>
        <DialogDescription>
          {t("attendance.swap.line", { shift: swap.shift.name, date: formatDay(swap.date) })}
        </DialogDescription>
        <div className="mt-4 space-y-4">
          <Field
            id="swap-cancel-reason"
            label={t("attendance.swap.cancelReason")}
            hint={t("corrections.reasonRange")}
          >
            <Textarea
              id="swap-cancel-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {cancel.isError ? <Alert tone="danger">{describeError(cancel.error, t)}</Alert> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!reasonIsValid(reason) || cancel.isPending}
            onClick={run}
          >
            {t("attendance.swap.cancelConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftSwapCard({
  employeeId,
  plantId,
  isSuperAdmin,
}: {
  employeeId: string;
  plantId: string;
  isSuperAdmin: boolean;
}) {
  const { t } = useTranslation();
  const swaps = useShiftSwaps(employeeId);
  const [dialog, setDialog] = useState<"new" | SwapLine | null>(null);
  const active = (swaps.data ?? []).filter((swap) => swap.cancelled === null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("attendance.swap.cardTitle")}</CardTitle>
        {isSuperAdmin ? (
          <p className="text-[13px] text-muted-foreground">{t("attendance.swap.superOnly")}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {swaps.isError ? <Alert tone="danger">{describeError(swaps.error, t)}</Alert> : null}
        {active.length === 0 && swaps.isSuccess ? (
          <p className="text-sm text-muted-foreground">{t("attendance.swap.none")}</p>
        ) : null}
        {active.map((swap) => (
          <div key={swap.id} className="space-y-2 rounded-md border p-3 text-sm">
            <p className="flex gap-2 font-bold">
              <Repeat className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {t("attendance.swap.line", { shift: swap.shift.name, date: formatDay(swap.date) })}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {t("attendance.swap.by", { name: swap.created_by, reason: swap.reason })}
            </p>
            {isSuperAdmin && swap.date >= todayIst() ? (
              <Button variant="outline" className="w-full" onClick={() => setDialog(swap)}>
                <X aria-hidden />
                {t("attendance.swap.cancel")}
              </Button>
            ) : null}
          </div>
        ))}
        {isSuperAdmin ? (
          <Button className="w-full" onClick={() => setDialog("new")}>
            <Repeat aria-hidden />
            {t("attendance.swap.button")}
          </Button>
        ) : null}
      </CardContent>
      {dialog === "new" ? (
        <NewSwapDialog employeeId={employeeId} plantId={plantId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog !== null && dialog !== "new" ? (
        <CancelSwapDialog swap={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </Card>
  );
}
