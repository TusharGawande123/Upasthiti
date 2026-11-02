// The two dialogs of the Holidays screen (Super Admin only): "Add holiday" and "Cancel this
// holiday". A holiday covers all plants or the chosen ones; paid is the default.
import { Check, CircleSlash, IndianRupee } from "lucide-react";
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
import { usePlants } from "@/features/plants/use-plants";
import { todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Holiday, useCancelHoliday, useCreateHoliday } from "./use-holidays";

const NAME_MIN = 2;
const NAME_MAX = 80;
const REASON_MIN = 3;
const REASON_MAX = 300;

// One big choice button of a pair (all plants / chosen plants, paid / unpaid).
function ChoiceCard({
  chosen,
  title,
  hint,
  icon: Icon,
  onChoose,
}: {
  chosen: boolean;
  title: string;
  hint?: string;
  icon?: typeof Check;
  onChoose: () => void;
}) {
  return (
    <label
      className={cn(
        "relative min-h-14 cursor-pointer rounded-lg border p-3 text-left",
        chosen ? "border-primary bg-primary-soft" : "border-border-strong bg-card",
      )}
    >
      <input
        type="radio"
        name="holiday-choice"
        checked={chosen}
        onChange={onChoose}
        className="peer sr-only"
      />
      <span className="flex items-center gap-2 font-bold">
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        {title}
      </span>
      {hint ? <span className="block text-[13px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function AddHolidayDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateHoliday();
  const plants = usePlants({ is_active: true });
  const [date, setDate] = useState(todayIst());
  const [name, setName] = useState("");
  const [allPlants, setAllPlants] = useState(true);
  const [chosenPlants, setChosenPlants] = useState<string[]>([]);
  const [isPaid, setIsPaid] = useState(true);

  const nameLength = name.trim().length;
  const nameWrong = name !== "" && (nameLength < NAME_MIN || nameLength > NAME_MAX);
  const valid =
    date !== "" &&
    nameLength >= NAME_MIN &&
    nameLength <= NAME_MAX &&
    (allPlants || chosenPlants.length > 0);

  const togglePlant = (plantId: string) =>
    setChosenPlants((current) =>
      current.includes(plantId) ? current.filter((id) => id !== plantId) : [...current, plantId],
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t("holidays.dialog.add.title")}</DialogTitle>
        <DialogDescription>{t("holidays.dialog.add.desc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            create.mutate(
              {
                date,
                name: name.trim(),
                is_paid: isPaid,
                all_plants: allPlants,
                plant_ids: allPlants ? [] : chosenPlants,
              },
              {
                onSuccess: () => {
                  toast.success(t("holidays.toast.added"));
                  onClose();
                },
              },
            );
          }}
        >
          {create.error ? (
            <Alert tone="danger">
              <span>{describeError(create.error, t)}</span>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field id="holiday-date" label={t("holidays.field.date")}>
              <Input
                id="holiday-date"
                type="date"
                value={date}
                className="tnum"
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field
              id="holiday-name"
              label={t("holidays.field.name")}
              error={nameWrong ? t("holidays.error.name") : undefined}
            >
              <Input
                id="holiday-name"
                value={name}
                maxLength={NAME_MAX}
                autoComplete="off"
                aria-invalid={nameWrong}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </div>

          <div>
            <p id="holiday-scope-label" className="mb-1 text-sm font-semibold">
              {t("holidays.scope.label")}
            </p>
            <div
              role="radiogroup"
              aria-labelledby="holiday-scope-label"
              className="grid gap-2 sm:grid-cols-2"
            >
              <ChoiceCard
                chosen={allPlants}
                title={t("holidays.scope.all")}
                onChoose={() => setAllPlants(true)}
              />
              <ChoiceCard
                chosen={!allPlants}
                title={t("holidays.scope.chosen")}
                hint={
                  allPlants
                    ? undefined
                    : t("holidays.scope.chosenCount", { count: chosenPlants.length })
                }
                onChoose={() => setAllPlants(false)}
              />
            </div>
            {allPlants ? null : (
              <ul className="mt-2 grid gap-1 rounded-md border p-2 sm:grid-cols-2">
                {plants.data?.items.map((plant) => (
                  <li key={plant.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm">
                      <input
                        type="checkbox"
                        checked={chosenPlants.includes(plant.id)}
                        onChange={() => togglePlant(plant.id)}
                      />
                      <span className="code font-bold">{plant.code}</span>
                      <span className="truncate text-muted-foreground">{plant.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!allPlants && chosenPlants.length === 0 ? (
              <p className="mt-1 text-[13px] font-medium text-destructive">
                {t("holidays.scope.pickOne")}
              </p>
            ) : null}
          </div>

          <div>
            <p id="holiday-pay-label" className="mb-1 text-sm font-semibold">
              {t("holidays.pay.label")}
            </p>
            <div
              role="radiogroup"
              aria-labelledby="holiday-pay-label"
              className="grid gap-2 sm:grid-cols-2"
            >
              <ChoiceCard
                chosen={isPaid}
                icon={IndianRupee}
                title={t("holidays.pay.paid")}
                hint={t("holidays.pay.paidHint")}
                onChoose={() => setIsPaid(true)}
              />
              <ChoiceCard
                chosen={!isPaid}
                icon={CircleSlash}
                title={t("holidays.pay.unpaid")}
                hint={t("holidays.pay.unpaidHint")}
                onChoose={() => setIsPaid(false)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              <Check aria-hidden />
              {t("holidays.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelHolidayDialog({
  holiday,
  onClose,
}: {
  holiday: Holiday;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cancel = useCancelHoliday();
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("holidays.dialog.cancel.title")}</DialogTitle>
        <DialogDescription>{t("holidays.dialog.cancel.desc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            cancel.mutate(
              { id: holiday.id, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t("holidays.toast.cancelled"));
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
            {t("holidays.dialog.cancel.summary", {
              name: holiday.name,
              date: formatDay(holiday.date),
            })}
          </p>
          <Field
            id="holiday-cancel-reason"
            label={t("holidays.cancelReason.label")}
            hint={t("holidays.cancelReason.hint")}
          >
            <Textarea
              id="holiday-cancel-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("holidays.keep")}
            </Button>
            <Button type="submit" variant="danger" disabled={!valid || cancel.isPending}>
              {t("holidays.cancel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
