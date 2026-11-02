// The two dialogs of the Leave screen (Super Admin only): "Add leave" and "Cancel this leave".
// Adding shows a live line ("4 working days. 01/11 is a weekly off ...") worked out from the
// plant's weekly off and holidays; the server counts again when it saves.
import { CalendarCheck, Check, CircleSlash, IndianRupee, Plane, User } from "lucide-react";
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
import { formatDay } from "@/features/attendance/attendance-format";
import { describeError } from "@/features/auth/error-message";
import { type Employee, useEmployees } from "@/features/employees/use-employees";
import { useHolidays } from "@/features/holidays/use-holidays";
import { useWeeklyOff } from "@/features/plants/use-plants";
import { addDays } from "@/lib/dates";
import { todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Leave, useCancelLeave, useCreateLeave } from "./use-leave";
import { countWorkingDays } from "./working-days";

const REASON_MIN = 3;
const REASON_MAX = 300;
const MAX_PREVIEW_NOTES = 3;
const MAX_PREVIEW_DAYS = 400; // a longer range is refused by the server anyway; skip the counting

/** "2026-11-01" -> "01/11" for the short notes. */
function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function EmployeePicker({ onPick }: { onPick: (employee: Employee) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const people = useEmployees({
    status: "active",
    q: search.trim() || undefined,
    page: 1,
    page_size: 20,
  });
  return (
    <div className="space-y-2">
      <Field id="leave-person-search" label={t("leave.field.employee")}>
        <Input
          id="leave-person-search"
          type="search"
          autoComplete="off"
          placeholder={t("leave.field.searchPeople")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
        {people.data?.items.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onPick(person)}
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{person.full_name}</span>
              <span className="code text-muted-foreground">{person.employee_code}</span>
              <span className="text-muted-foreground">{person.plant_code}</span>
            </button>
          </li>
        ))}
        {people.data && people.data.items.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">{t("leave.noPeople")}</li>
        ) : null}
      </ul>
    </div>
  );
}

function PayChoice({
  paid,
  chosen,
  onChoose,
}: {
  paid: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = paid ? IndianRupee : CircleSlash;
  return (
    <label
      className={cn(
        "relative min-h-14 cursor-pointer rounded-lg border p-3 text-left",
        chosen ? "border-primary bg-primary-soft" : "border-border-strong bg-card",
      )}
    >
      <input
        type="radio"
        name="leave-pay"
        checked={chosen}
        onChange={onChoose}
        className="peer sr-only"
      />
      <span className="flex items-center gap-2 font-bold">
        <Icon className="size-4" aria-hidden />
        {t(paid ? "leave.paid.title" : "leave.unpaid.title")}
      </span>
      <span className="block text-[13px] text-muted-foreground">
        {t(paid ? "leave.paid.hint" : "leave.unpaid.hint")}
      </span>
    </label>
  );
}

// The line under the dates: how many working days, and which days are not counted.
function Preview({ employee, from, to }: { employee: Employee; from: string; to: string }) {
  const { t } = useTranslation();
  const weeklyOff = useWeeklyOff(employee.plant_id);
  const holidaysFirst = useHolidays(Number(from.slice(0, 4)), employee.plant_id);
  const holidaysLast = useHolidays(Number(to.slice(0, 4)), employee.plant_id);

  if (!weeklyOff.data || !holidaysFirst.data || !holidaysLast.data) return null;
  const holidays = [...holidaysFirst.data, ...holidaysLast.data];
  const count = countWorkingDays(from, to, weeklyOff.data.history, holidays, employee.plant_id);
  const notes = count.skipped.slice(0, MAX_PREVIEW_NOTES).map((day) =>
    t(day.reason === "weekly_off" ? "leave.previewWeeklyOff" : "leave.previewHoliday", {
      date: shortDate(day.date),
    }),
  );
  const more = count.skipped.length - notes.length;
  return (
    <p
      aria-live="polite"
      className="flex items-start gap-2 rounded-md bg-success-soft p-3 text-sm text-success"
    >
      <CalendarCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong>{t("leave.previewDays", { count: count.workingDays })}</strong> {notes.join(" ")}
        {more > 0 ? ` ${t("leave.previewMore", { count: more })}` : ""}
      </span>
    </p>
  );
}

export function AddLeaveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateLeave();
  const today = todayIst();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [isPaid, setIsPaid] = useState(true);
  const [reason, setReason] = useState("");

  const datesGiven = fromDate !== "" && toDate !== "";
  const datesWrong = datesGiven && toDate < fromDate;
  const reasonLength = reason.trim().length;
  const valid =
    employee !== null &&
    datesGiven &&
    !datesWrong &&
    reasonLength >= REASON_MIN &&
    reasonLength <= REASON_MAX;
  const showPreview =
    employee !== null && datesGiven && !datesWrong && addDays(fromDate, MAX_PREVIEW_DAYS) >= toDate;

  const submit = () => {
    if (!employee || !valid) return;
    create.mutate(
      {
        employee_id: employee.id,
        from_date: fromDate,
        to_date: toDate,
        is_paid: isPaid,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t("leave.toast.added"));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
            <Plane className="size-5" aria-hidden />
          </span>
          {t("leave.dialog.add.title")}
        </DialogTitle>
        <DialogDescription>{t("leave.dialog.add.desc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {create.error ? (
            <Alert tone="danger">
              <span>{describeError(create.error, t)}</span>
            </Alert>
          ) : null}

          {employee ? (
            <div>
              <p className="mb-1 text-sm font-semibold">{t("leave.field.employee")}</p>
              <div className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">
                <User className="size-4 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <strong>{employee.full_name}</strong> · {employee.employee_code} ·{" "}
                  {employee.plant_code}
                </span>
                <button
                  type="button"
                  className="cursor-pointer font-semibold text-primary hover:underline"
                  onClick={() => setEmployee(null)}
                >
                  {t("leave.change")}
                </button>
              </div>
            </div>
          ) : (
            <EmployeePicker onPick={setEmployee} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field id="leave-from" label={t("leave.field.firstDay")}>
              <Input
                id="leave-from"
                type="date"
                value={fromDate}
                className="tnum"
                onChange={(event) => setFromDate(event.target.value)}
              />
            </Field>
            <Field
              id="leave-to"
              label={t("leave.field.lastDay")}
              error={datesWrong ? t("leave.error.dates") : undefined}
            >
              <Input
                id="leave-to"
                type="date"
                value={toDate}
                className="tnum"
                aria-invalid={datesWrong}
                onChange={(event) => setToDate(event.target.value)}
              />
            </Field>
          </div>

          {showPreview && employee ? (
            <Preview employee={employee} from={fromDate} to={toDate} />
          ) : null}

          <div>
            <p id="leave-pay-label" className="mb-1 text-sm font-semibold">
              {t("leave.field.pay")}
            </p>
            <div
              role="radiogroup"
              aria-labelledby="leave-pay-label"
              className="grid gap-2 sm:grid-cols-2"
            >
              <PayChoice paid chosen={isPaid} onChoose={() => setIsPaid(true)} />
              <PayChoice paid={false} chosen={!isPaid} onChoose={() => setIsPaid(false)} />
            </div>
          </div>

          <Field id="leave-reason" label={t("leave.field.reason")} hint={t("leave.reasonHint")}>
            <Textarea
              id="leave-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              <Check aria-hidden />
              {t("leave.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelLeaveDialog({ leave, onClose }: { leave: Leave; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelLeave();
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("leave.dialog.cancel.title")}</DialogTitle>
        <DialogDescription>{t("leave.dialog.cancel.desc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            cancel.mutate(
              { id: leave.id, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t("leave.toast.cancelled"));
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
          <p className="rounded-md bg-muted p-3 text-sm font-semibold">
            {t("leave.dialog.cancel.summary", {
              name: leave.employee.name,
              from: formatDay(leave.from_date),
              to: formatDay(leave.to_date),
            })}
          </p>
          <Field
            id="leave-cancel-reason"
            label={t("leave.cancelReason.label")}
            hint={t("leave.cancelReason.hint")}
          >
            <Textarea
              id="leave-cancel-reason"
              value={reason}
              maxLength={REASON_MAX}
              placeholder={t("leave.cancelReason.placeholder")}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("leave.keep")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || cancel.isPending}>
              {t("leave.cancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
