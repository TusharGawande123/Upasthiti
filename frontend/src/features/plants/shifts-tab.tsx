// Shifts of a plant: a list of shifts with their rules in force today and the add / edit-rules form
// (shift-form-dialog.tsx). Only the Super Admin changes shifts; the others read.
import { Ban, CircleCheck, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay, formatDuration } from "@/features/attendance/attendance-format";
import { describeError } from "@/features/auth/error-message";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { ShiftFormDialog } from "./shift-form-dialog";
import { shortTime } from "./shift-summary";
import { type Shift, useShiftActiveToggle, useShifts } from "./use-plants";

type TabProps = { plantId: string; plantCode: string; plantLabel: string; canEdit: boolean };

function ShiftRow({
  shift,
  canEdit,
  onEdit,
  onSwitch,
}: {
  shift: Shift;
  canEdit: boolean;
  onEdit: (shift: Shift) => void;
  onSwitch: (shift: Shift) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-bold">
          {shift.name}
          {shift.is_active ? (
            <Badge tone="success">
              <CircleCheck aria-hidden />
              {t("plants.status.active")}
            </Badge>
          ) : (
            <Badge tone="neutral">
              <Ban aria-hidden />
              {t("shiftForm.list.switchedOff")}
            </Badge>
          )}
        </p>
        <p className="tnum flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {shortTime(shift.start_time)} – {shortTime(shift.end_time)}
            {shift.crosses_midnight ? ` ${t("plants.shifts.nextDay")}` : ""}
          </span>
          <span>
            {t("shiftForm.list.fullDay", { duration: formatDuration(shift.shift_length_min) })}
          </span>
          <span>{t("shiftForm.list.grace", { count: shift.grace_min })}</span>
          <span>
            {t("shiftForm.list.halfDay", { duration: formatDuration(shift.half_day_min) })}
          </span>
          <span>
            {t("shiftForm.list.overtime", {
              duration: formatDuration(shift.overtime_min_minutes),
            })}
          </span>
        </p>
        {shift.upcoming_rules ? (
          <p className="text-[13px] font-semibold text-warning">
            {t("shiftForm.list.upcoming", { date: formatDay(shift.upcoming_rules.effective_from) })}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onEdit(shift)}>
            <Pencil aria-hidden />
            {t("shiftForm.list.editRules")}
          </Button>
          <Button variant="outline" onClick={() => onSwitch(shift)}>
            {shift.is_active ? t("plants.deactivate") : t("plants.reactivate")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ShiftsTab({ plantId, plantCode, plantLabel, canEdit }: TabProps) {
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
            {t("shiftForm.add")}
          </Button>
        ) : null}
      </div>

      {shifts.isError ? <Alert tone="danger">{describeError(shifts.error, t)}</Alert> : null}
      {shifts.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {shifts.data ? (
        <Card className="overflow-hidden">
          {shifts.data.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">{t("plants.shifts.empty")}</p>
          ) : (
            <ul className="divide-y">
              {shifts.data.map((shift) => (
                <ShiftRow
                  key={shift.id}
                  shift={shift}
                  canEdit={canEdit}
                  onEdit={(chosen) => setEditing({ shift: chosen })}
                  onSwitch={setSwitching}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>{t("shiftForm.list.count", { count: shifts.data.length })}</span>
            <span>{t("shiftForm.list.footer")}</span>
          </div>
        </Card>
      ) : null}

      {editing ? (
        <ShiftFormDialog
          key={editing.shift?.id ?? "new"}
          plantId={plantId}
          plantCode={plantCode}
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
