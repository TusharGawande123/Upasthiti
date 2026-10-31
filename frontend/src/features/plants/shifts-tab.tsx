// Shifts of a plant: a table plus the add/edit dialog. The dialog explains the shift in one
// live sentence ("starts 19:00, ends next day at 07:00 (12 h 00 min)") so mistakes are obvious.
// M5: grace counts at both ends, the shift length is the full day, overtime starts at the shift
// end and counts only from the smallest overtime; rule changes apply from a date.
import type { TFunction } from "i18next";
import { Ban, CircleCheck, Moon, Pencil, Plus, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { todayIst } from "@/lib/format";
import {
  endsNextDay,
  fromMinutes,
  shiftLengthMinutes,
  shortTime,
  splitMinutes,
  toMinutes,
} from "./shift-summary";
import { type Shift, useSaveShift, useShiftActiveToggle, useShifts } from "./use-plants";

function formatLength(totalMinutes: number, t: TFunction) {
  const { hours, minutes } = splitMinutes(totalMinutes);
  return t("plants.shifts.length", { hours, minutes: String(minutes).padStart(2, "0") });
}

type DialogProps = {
  plantId: string;
  plantLabel: string;
  shift: Shift | null;
  onClose: () => void;
};

function ShiftDialog({ plantId, plantLabel, shift, onClose }: DialogProps) {
  const { t } = useTranslation();
  const save = useSaveShift(plantId);
  const [name, setName] = useState(shift?.name ?? "");
  const [start, setStart] = useState(shift ? shortTime(shift.start_time) : "07:00");
  const [end, setEnd] = useState(shift ? shortTime(shift.end_time) : "19:00");
  const [grace, setGrace] = useState(shift?.grace_min ?? 30);
  const [halfDay, setHalfDay] = useState(shift?.half_day_min ?? 240);
  const [overtimeMin, setOvertimeMin] = useState(shift?.overtime_min_minutes ?? 120);
  const today = todayIst();
  const [rulesFrom, setRulesFrom] = useState(today);

  const sameTimes = start === end;
  const nextDay = endsNextDay(start, end);
  const valid = name.trim().length > 0 && !sameTimes && start !== "" && end !== "";

  const submit = () =>
    save.mutate(
      {
        id: shift?.id,
        input: {
          name: name.trim(),
          start_time: start,
          end_time: end,
          grace_min: grace,
          half_day_min: halfDay,
          overtime_min_minutes: overtimeMin,
          ...(shift ? { rules_effective_from: rulesFrom } : {}),
        },
      },
      { onSuccess: onClose },
    );

  const numberField = (
    id: string,
    label: string,
    value: number,
    onChange: (next: number) => void,
    max: number,
  ) => (
    <Field id={id} label={label}>
      <div className="flex">
        <Input
          id={id}
          type="number"
          min={0}
          max={max}
          value={value}
          className="tnum rounded-r-none"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="grid place-items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
          {t("plants.shifts.min")}
        </span>
      </div>
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t(shift ? "plants.shifts.editTitle" : "plants.shifts.addTitle")}</DialogTitle>
        <DialogDescription>{plantLabel}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) submit();
          }}
        >
          {save.error ? (
            <Alert tone="danger">
              <span>{describeError(save.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="shift-name" label={t("plants.shifts.name")}>
            <Input
              id="shift-name"
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {/* 24-hour native time fields: no AM/PM confusion on the shop floor. */}
            <Field id="shift-start" label={t("plants.shifts.starts")}>
              <Input
                id="shift-start"
                type="time"
                step={60}
                value={start}
                className="tnum text-lg"
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field id="shift-end" label={t("plants.shifts.ends")}>
              <Input
                id="shift-end"
                type="time"
                step={60}
                value={end}
                className="tnum text-lg"
                onChange={(event) => setEnd(event.target.value)}
              />
            </Field>
          </div>

          {sameTimes ? (
            <Alert tone="danger">{t("errors.SHIFT_TIMES_INVALID")}</Alert>
          ) : (
            <Alert tone="info" className="flex-col gap-1">
              <span className="flex items-center gap-2 font-bold">
                {nextDay ? <Moon aria-hidden /> : <Sun aria-hidden />}
                {t(nextDay ? "plants.shifts.sentenceNextDay" : "plants.shifts.sentenceSameDay", {
                  name: name.trim() || t("plants.shifts.thisShift"),
                  start,
                  end,
                  length: formatLength(shiftLengthMinutes(start, end), t),
                })}
              </span>
              <span>
                {t("plants.shifts.graceRule", {
                  onTime: fromMinutes(toMinutes(start) + grace),
                  end,
                })}
              </span>
              <span>
                {t("plants.shifts.fullDayRule", {
                  length: formatLength(shiftLengthMinutes(start, end), t),
                })}
              </span>
              <span>{t("plants.shifts.halfDayRule", { length: formatLength(halfDay, t) })}</span>
              <span>
                {t("plants.shifts.overtimeRule", {
                  time: end,
                  length: formatLength(overtimeMin, t),
                })}
              </span>
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-3">
            {numberField("shift-grace", t("plants.shifts.grace"), grace, setGrace, 120)}
            {numberField("shift-half", t("plants.shifts.halfDay"), halfDay, setHalfDay, 1440)}
            {numberField(
              "shift-ot",
              t("plants.shifts.overtimeMin"),
              overtimeMin,
              setOvertimeMin,
              480,
            )}
          </div>
          {shift ? (
            <Field id="shift-rules-from" label={t("plants.shifts.rulesFrom")}>
              <Input
                id="shift-rules-from"
                type="date"
                min={today}
                value={rulesFrom}
                className="tnum"
                onChange={(event) => setRulesFrom(event.target.value)}
              />
            </Field>
          ) : null}
          <p className="text-[13px] text-muted-foreground">{t("plants.shifts.futureOnly")}</p>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t("plants.shifts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type TabProps = { plantId: string; plantLabel: string; canEdit: boolean };

export function ShiftsTab({ plantId, plantLabel, canEdit }: TabProps) {
  const { t } = useTranslation();
  const shifts = useShifts(plantId);
  const toggle = useShiftActiveToggle();
  // `editing` = null: closed; { shift: null }: adding; { shift }: editing.
  const [editing, setEditing] = useState<{ shift: Shift | null } | null>(null);
  const [switching, setSwitching] = useState<Shift | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t("plants.shifts.description")}</p>
        {canEdit ? (
          <Button onClick={() => setEditing({ shift: null })}>
            <Plus aria-hidden />
            {t("plants.shifts.add")}
          </Button>
        ) : null}
      </div>

      {shifts.isError ? <Alert tone="danger">{describeError(shifts.error, t)}</Alert> : null}
      {shifts.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {shifts.data ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("plants.shifts.name")}</TableHead>
                <TableHead>{t("plants.shifts.times")}</TableHead>
                <TableHead>{t("plants.shifts.grace")}</TableHead>
                <TableHead>{t("plants.shifts.overtimeMin")}</TableHead>
                <TableHead>{t("plants.columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.data.map((shift) => (
                <TableRow key={shift.id}>
                  <TableCell className="font-semibold">{shift.name}</TableCell>
                  <TableCell className="tnum">
                    {shortTime(shift.start_time)}–{shortTime(shift.end_time)}
                    {shift.crosses_midnight ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("plants.shifts.nextDay")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tnum">
                    {t("plants.shifts.minutes", { count: shift.grace_min })}
                  </TableCell>
                  <TableCell className="tnum">
                    {formatLength(shift.overtime_min_minutes, t)}
                  </TableCell>
                  <TableCell>
                    {shift.is_active ? (
                      <Badge tone="success">
                        <CircleCheck aria-hidden />
                        {t("plants.status.active")}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">
                        <Ban aria-hidden />
                        {t("plants.status.inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("plants.renameItem", { name: shift.name })}
                          onClick={() => setEditing({ shift })}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setSwitching(shift)}>
                          {shift.is_active ? t("plants.deactivate") : t("plants.reactivate")}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {shifts.data.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">{t("plants.shifts.empty")}</p>
          ) : null}
        </Card>
      ) : null}

      {editing ? (
        <ShiftDialog
          key={editing.shift?.id ?? "new"}
          plantId={plantId}
          plantLabel={plantLabel}
          shift={editing.shift}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ReasonDialog
        open={switching !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSwitching(null);
            toggle.reset();
          }
        }}
        title={
          switching
            ? t(switching.is_active ? "plants.deactivateTitle" : "plants.reactivateTitle", {
                name: switching.name,
              })
            : ""
        }
        confirmLabel={switching?.is_active ? t("plants.deactivate") : t("plants.reactivate")}
        isPending={toggle.isPending}
        error={toggle.error ? describeError(toggle.error, t) : undefined}
        onConfirm={(reason) =>
          switching &&
          toggle.mutate(
            { id: switching.id, active: !switching.is_active, reason },
            { onSuccess: () => setSwitching(null) },
          )
        }
      />
    </div>
  );
}
