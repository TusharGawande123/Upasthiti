// The three dialogs of an employee: transfer to another plant, mark as left (Super Admin) and
// reactivate. People are never deleted: "left" keeps all their history (Labour Codes).
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
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { useNamedItems, usePlants, useShifts } from "@/features/plants/use-plants";
import { todayIst } from "@/lib/format";
import {
  type Employee,
  isPendingApproval,
  useCancelConversion,
  useConvertEmployee,
  useMarkLeft,
  useReactivate,
  useTransferEmployee,
} from "./use-employees";

const today = todayIst;
const MIN_REASON = 3;

type DialogProps = { employee: Employee; onClose: () => void };

export function TransferDialog({
  employee,
  forApproval,
  onClose,
}: DialogProps & { forApproval: boolean }) {
  const { t } = useTranslation();
  const plants = usePlants({ is_active: true });
  const transfer = useTransferEmployee(employee.id);
  const [toPlant, setToPlant] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState("");

  const categories = useNamedItems(toPlant, "categories");
  const departments = useNamedItems(toPlant, "departments");
  const shifts = useShifts(toPlant);
  const valid =
    toPlant !== "" && categoryId !== "" && shiftId !== "" && reason.trim().length >= MIN_REASON;

  const submit = () =>
    transfer.mutate(
      {
        to_plant_id: toPlant,
        category_id: categoryId,
        department_id: departmentId || null,
        shift_id: shiftId,
        effective_from: effectiveFrom,
        reason: reason.trim(),
      },
      {
        onSuccess: (result) => {
          toast.success(
            isPendingApproval(result) ? t("employees.form.sent") : t("employees.transfer.done"),
          );
          onClose();
        },
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("employees.transfer.title", { name: employee.full_name })}</DialogTitle>
        <DialogDescription>
          {forApproval ? t("employees.bulk.approvalNote") : t("employees.transfer.description")}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) submit();
          }}
        >
          {transfer.error ? (
            <Alert tone="danger">
              <span>{describeError(transfer.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="transfer-plant" label={t("employees.transfer.toPlant")}>
            <Select
              id="transfer-plant"
              value={toPlant}
              onChange={(event) => {
                setToPlant(event.target.value);
                setCategoryId("");
                setDepartmentId("");
                setShiftId("");
              }}
            >
              <option value="">{t("employees.form.choosePlant")}</option>
              {plants.data?.items
                .filter((plant) => plant.id !== employee.plant_id)
                .map((plant) => (
                  <option key={plant.id} value={plant.id}>
                    {plant.code} · {plant.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="transfer-category" label={t("employees.columns.category")}>
              <Select
                id="transfer-category"
                value={categoryId}
                disabled={!toPlant}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">{t("employees.form.chooseCategory")}</option>
                {categories.data
                  ?.filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="transfer-shift" label={t("employees.columns.shift")}>
              <Select
                id="transfer-shift"
                value={shiftId}
                disabled={!toPlant}
                onChange={(event) => setShiftId(event.target.value)}
              >
                <option value="">{t("employees.form.chooseShift")}</option>
                {shifts.data
                  ?.filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="transfer-department" label={t("employees.columns.department")}>
              <Select
                id="transfer-department"
                value={departmentId}
                disabled={!toPlant}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t("employees.form.noDepartment")}</option>
                {departments.data
                  ?.filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              id="transfer-date"
              label={t("employees.transfer.effectiveFrom")}
              hint={t("employees.transfer.dateHint")}
            >
              <Input
                id="transfer-date"
                type="date"
                value={effectiveFrom}
                min={today()}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </Field>
          </div>
          <Field
            id="transfer-reason"
            label={t("common.reason")}
            hint={t("employees.transfer.historyNote")}
          >
            <Textarea
              id="transfer-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || transfer.isPending}>
              {transfer.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {forApproval ? t("employees.sendForApproval") : t("employees.transfer.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The first day of last month, as YYYY-MM-DD: the earliest day a conversion may start (M5c). */
function earliestConversionDay(): string {
  const [year = 0, month = 1] = today().split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 2, 1));
  return first.toISOString().slice(0, 10);
}

function latestConversionDay(): string {
  const limit = new Date(`${today()}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 60);
  return limit.toISOString().slice(0, 10);
}

/**
 * Temporary to permanent (M5c). The Super Admin converts at once (or plans it); a Corporate Head
 * asks and the Super Admin decides. After a conversion the Super Admin can go straight to the
 * face enrolment (F-87), because until the face is enrolled the person cannot punch.
 */
export function ConvertDialog({
  employee,
  forApproval,
  onClose,
  onEnrol,
}: {
  employee: Employee;
  forApproval: boolean;
  onClose: () => void;
  onEnrol: () => void;
}) {
  const { t } = useTranslation();
  const convert = useConvertEmployee(employee.id);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<"converted" | "planned" | "asked" | null>(null);
  const valid = effectiveFrom !== "" && reason.trim().length >= MIN_REASON;

  if (done === "converted" && !forApproval) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>{t("employees.conversion.doneTitle")}</DialogTitle>
          <DialogDescription>{t("employees.conversion.doneText")}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("employees.conversion.later")}
            </Button>
            <Button onClick={onEnrol}>{t("employees.conversion.enrolNow")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>
          {forApproval
            ? t("employees.conversion.askTitle", { name: employee.full_name })
            : t("employees.conversion.title", { name: employee.full_name })}
        </DialogTitle>
        <DialogDescription>{t("employees.conversion.description")}</DialogDescription>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>{t("employees.conversion.changeType")}</li>
          <li>{t("employees.conversion.changeContractor")}</li>
          <li>{t("employees.conversion.changeCard")}</li>
          <li>{t("employees.conversion.changeFace")}</li>
        </ul>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {t("employees.conversion.refusedNote")}
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            convert.mutate(
              { effective_from: effectiveFrom, reason: reason.trim() },
              {
                onSuccess: (result) => {
                  if (isPendingApproval(result)) {
                    toast.success(t("employees.conversion.sentForApproval"));
                    onClose();
                  } else if (effectiveFrom > today()) {
                    toast.success(t("employees.conversion.planned"));
                    onClose();
                  } else {
                    setDone("converted");
                  }
                },
              },
            );
          }}
        >
          {convert.error ? (
            <Alert tone="danger">
              <span>{describeError(convert.error, t)}</span>
            </Alert>
          ) : null}
          <Field
            id="convert-date"
            label={t("employees.conversion.effectiveFrom")}
            hint={t("employees.conversion.effectiveHint")}
          >
            <Input
              id="convert-date"
              type="date"
              min={earliestConversionDay()}
              max={latestConversionDay()}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </Field>
          <Field id="convert-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="convert-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || convert.isPending}>
              {convert.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {forApproval ? t("employees.conversion.askButton") : t("employees.conversion.button")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancels a planned conversion before its day (M5c, Super Admin). */
export function CancelConversionDialog({ employee, onClose }: DialogProps) {
  const { t } = useTranslation();
  const cancel = useCancelConversion(employee.id);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MIN_REASON;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("employees.conversion.cancelTitle")}</DialogTitle>
        <DialogDescription>{t("employees.conversion.cancelText")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid)
              cancel.mutate(
                { reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t("employees.conversion.cancelled"));
                    onClose();
                  },
                },
              );
          }}
        >
          {cancel.error ? (
            <Alert tone="danger">
              <span>{describeError(cancel.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="cancel-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || cancel.isPending}>
              {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t("employees.conversion.cancelButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MarkLeftDialog({ employee, onClose }: DialogProps) {
  const { t } = useTranslation();
  const markLeft = useMarkLeft(employee.id);
  const [leftOn, setLeftOn] = useState(today());
  const [reason, setReason] = useState("");
  const valid = leftOn !== "" && reason.trim().length >= MIN_REASON;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("employees.left.title", { name: employee.full_name })}</DialogTitle>
        <DialogDescription>{t("employees.left.description")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid)
              markLeft.mutate(
                { left_on: leftOn, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t("employees.left.done"));
                    onClose();
                  },
                },
              );
          }}
        >
          {markLeft.error ? (
            <Alert tone="danger">
              <span>{describeError(markLeft.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="left-date" label={t("employees.left.leftOn")}>
            <Input
              id="left-date"
              type="date"
              value={leftOn}
              onChange={(event) => setLeftOn(event.target.value)}
            />
          </Field>
          <Field id="left-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="left-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || markLeft.isPending}>
              {markLeft.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t("employees.markLeft")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReactivateDialog({ employee, onClose }: DialogProps) {
  const { t } = useTranslation();
  const reactivate = useReactivate(employee.id);
  const [joinedOn, setJoinedOn] = useState(today());
  const [reason, setReason] = useState("");
  const valid = joinedOn !== "" && reason.trim().length >= MIN_REASON;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("employees.reactivate.title", { name: employee.full_name })}</DialogTitle>
        <DialogDescription>{t("employees.reactivate.description")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid)
              reactivate.mutate(
                { joined_on: joinedOn, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t("employees.reactivate.done"));
                    onClose();
                  },
                },
              );
          }}
        >
          {reactivate.error ? (
            <Alert tone="danger">
              <span>{describeError(reactivate.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="rejoin-date" label={t("employees.form.joinedOn")}>
            <Input
              id="rejoin-date"
              type="date"
              value={joinedOn}
              onChange={(event) => setJoinedOn(event.target.value)}
            />
          </Field>
          <Field id="rejoin-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="rejoin-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || reactivate.isPending}>
              {reactivate.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t("employees.reactivate.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
