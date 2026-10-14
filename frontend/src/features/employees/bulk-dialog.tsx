// The dialog behind the bulk bar: move people to a shift, category or department, or mark them
// as left (Super Admin). All-or-nothing: if one person fails, nobody is changed. For a
// Corporate Head the same request is sent for approval instead.
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
import { useNamedItems, useShifts } from "@/features/plants/use-plants";
import { type BulkAction, isPendingApproval, useBulkChange } from "./use-employees";

type Props = {
  action: BulkAction | null;
  plantId: string; // all selected people are in this plant (the bar checks it first)
  employeeIds: string[];
  forApproval: boolean;
  onClose: () => void;
  onDone: () => void;
};

export function BulkDialog({ action, plantId, employeeIds, forApproval, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const shifts = useShifts(plantId);
  const categories = useNamedItems(plantId, "categories");
  const departments = useNamedItems(plantId, "departments");
  const change = useBulkChange();
  const [choice, setChoice] = useState("");
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  if (!action) return null;

  const needsChoice = action !== "mark_left" && action !== "change_department";
  const valid = reason.trim().length >= 3 && (!needsChoice || choice !== "");

  const close = () => {
    change.reset();
    setChoice("");
    setReason("");
    onClose();
  };

  const submit = () => {
    const params: Record<string, string | null> =
      action === "change_shift"
        ? { shift_id: choice, from_date: fromDate }
        : action === "change_category"
          ? { category_id: choice }
          : action === "change_department"
            ? { department_id: choice || null }
            : { left_on: fromDate };
    change.mutate(
      { action, employee_ids: employeeIds, params, reason: reason.trim() },
      {
        onSuccess: (result) => {
          toast.success(
            isPendingApproval(result)
              ? t("employees.bulk.sent", { count: employeeIds.length })
              : t("employees.bulk.done", { count: result.updated }),
          );
          close();
          onDone();
        },
      },
    );
  };

  const options =
    action === "change_shift"
      ? (shifts.data ?? [])
          .filter((shift) => shift.is_active)
          .map((shift) => [shift.id, shift.name])
      : action === "change_category"
        ? (categories.data ?? [])
            .filter((item) => item.is_active)
            .map((item) => [item.id, item.name])
        : (departments.data ?? [])
            .filter((item) => item.is_active)
            .map((item) => [item.id, item.name]);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogTitle>
          {t(`employees.bulk.title.${action}`, { count: employeeIds.length })}
        </DialogTitle>
        <DialogDescription>
          {forApproval ? t("employees.bulk.approvalNote") : t("employees.bulk.allOrNothing")}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) submit();
          }}
        >
          {change.error ? (
            <Alert tone="danger">
              <span>{describeError(change.error, t)}</span>
            </Alert>
          ) : null}
          {action !== "mark_left" ? (
            <Field id="bulk-choice" label={t(`employees.bulk.choose.${action}`)}>
              <Select
                id="bulk-choice"
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">
                  {action === "change_department"
                    ? t("employees.bulk.noDepartment")
                    : t("employees.bulk.pick")}
                </option>
                {options.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {action === "change_shift" || action === "mark_left" ? (
            <Field
              id="bulk-date"
              label={t(
                action === "mark_left" ? "employees.bulk.leftOn" : "employees.bulk.fromDate",
              )}
            >
              <Input
                id="bulk-date"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </Field>
          ) : null}
          <Field id="bulk-reason" label={t("common.reason")} hint={t("common.reasonExplain")}>
            <Textarea
              id="bulk-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={action === "mark_left" ? "danger" : "primary"}
              disabled={!valid || change.isPending}
            >
              {change.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {forApproval ? t("employees.sendForApproval") : t(`employees.bulk.confirm.${action}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
