// The shift form (spec M5 §4.10, design gate C screen 4): name, times, grace after the start,
// half-day hours, smallest overtime and the date the rules apply from. The full day is the shift
// length (shown, never typed). A live helper explains the typed times; an edited shift also shows
// its rule history. A new rule starts on its date and never changes days already worked.
import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDay, formatDuration } from "@/features/attendance/attendance-format";
import { describeError } from "@/features/auth/error-message";
import { openPdfInNewTab } from "@/features/qr-cards/use-qr-cards";
import { apiBlob } from "@/lib/api-client";
import { todayIst } from "@/lib/format";
import { ShiftHelper } from "./shift-helper";
import { endsNextDay, shiftLengthMinutes, shortTime } from "./shift-summary";
import { type Shift, type ShiftRules, useSaveShift, useShiftRuleVersions } from "./use-plants";

const MAX_GRACE = 120;
const MAX_OVERTIME_MIN = 480;

type RuleState = "willApply" | "inForce" | "earlier";

/** Newest first; the first one that has started is in force, later ones will apply, older are earlier. */
export function describeRuleVersions(versions: ShiftRules[], today: string) {
  const newestFirst = [...versions].sort(
    (a, b) =>
      b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at),
  );
  const inForceIndex = newestFirst.findIndex((version) => version.effective_from <= today);
  return newestFirst.map((version, index): { version: ShiftRules; state: RuleState } => ({
    version,
    state:
      version.effective_from > today ? "willApply" : index === inForceIndex ? "inForce" : "earlier",
  }));
}

function RuleHistory({ shiftId }: { shiftId: string }) {
  const { t } = useTranslation();
  const versions = useShiftRuleVersions(shiftId);
  if (versions.isPending) return <Skeleton className="h-20 w-full" />;
  if (versions.isError) return <Alert tone="danger">{t("shiftForm.history.error")}</Alert>;
  const rows = describeRuleVersions(versions.data, todayIst());
  return (
    <section className="space-y-2" aria-label={t("shiftForm.history.title")}>
      <h3 className="text-sm font-bold">{t("shiftForm.history.title")}</h3>
      <ul className="divide-y rounded-lg border">
        {rows.map(({ version, state }) => (
          <li
            key={`${version.effective_from}-${version.created_at}`}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm ${state === "inForce" ? "bg-primary-soft" : ""}`}
          >
            <strong className="min-w-32">
              {t("shiftForm.history.row", { date: formatDay(version.effective_from) })}
            </strong>
            <span className="min-w-0 flex-1">
              {t("shiftForm.history.summary", {
                grace: version.grace_min,
                half: formatDuration(version.half_day_min),
                ot: formatDuration(version.overtime_min_minutes),
              })}
              <span className="block text-xs text-muted-foreground">
                {t("shiftForm.history.saved", { date: formatDay(version.created_at.slice(0, 10)) })}
              </span>
            </span>
            <Badge
              tone={state === "earlier" ? "neutral" : state === "inForce" ? "primary" : "warning"}
            >
              {t(`shiftForm.history.${state}`)}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted-foreground">{t("shiftForm.history.footnote")}</p>
    </section>
  );
}

type Props = {
  plantId: string;
  plantCode: string;
  plantLabel: string;
  shift: Shift | null;
  onClose: () => void;
};

export function ShiftFormDialog({ plantId, plantCode, plantLabel, shift, onClose }: Props) {
  const { t } = useTranslation();
  const save = useSaveShift(plantId);
  const today = todayIst();
  const [name, setName] = useState(shift?.name ?? "");
  const [start, setStart] = useState(shift ? shortTime(shift.start_time) : "");
  const [end, setEnd] = useState(shift ? shortTime(shift.end_time) : "");
  const [grace, setGrace] = useState(String(shift?.grace_min ?? 30));
  const [halfHours, setHalfHours] = useState(String(Math.floor((shift?.half_day_min ?? 240) / 60)));
  const [halfMinutes, setHalfMinutes] = useState(String((shift?.half_day_min ?? 240) % 60));
  const [overtimeMin, setOvertimeMin] = useState(String(shift?.overtime_min_minutes ?? 120));
  const [rulesFrom, setRulesFrom] = useState(today);

  const timesGiven = start !== "" && end !== "";
  const sameTimes = timesGiven && start === end;
  const fullDayMin = timesGiven && !sameTimes ? shiftLengthMinutes(start, end) : 0;
  const graceMin = Number(grace);
  const halfDayMin = Number(halfHours) * 60 + Number(halfMinutes);
  const overtime = Number(overtimeMin);

  const graceWrong = grace === "" || !(graceMin >= 0 && graceMin <= MAX_GRACE);
  const halfDayWrong = fullDayMin > 0 && !(halfDayMin >= 0 && halfDayMin < fullDayMin);
  const overtimeWrong = overtimeMin === "" || !(overtime >= 0 && overtime <= MAX_OVERTIME_MIN);
  const dateWrong = shift !== null && (rulesFrom === "" || rulesFrom < today);
  const valid =
    name.trim() !== "" &&
    fullDayMin > 0 &&
    !graceWrong &&
    !halfDayWrong &&
    !overtimeWrong &&
    !dateWrong;

  const openPoster = () =>
    openPdfInNewTab(
      () => apiBlob(`/plants/${plantId}/gate-poster.pdf`, { method: "GET" }),
      `gate-poster-${plantCode}.pdf`,
    ).catch((failure) => toast.error(describeError(failure, t)));

  const submit = () =>
    save.mutate(
      {
        id: shift?.id,
        input: {
          name: name.trim(),
          start_time: start,
          end_time: end,
          grace_min: graceMin,
          half_day_min: halfDayMin,
          overtime_min_minutes: overtime,
          ...(shift ? { rules_effective_from: rulesFrom } : {}),
        },
      },
      {
        onSuccess: () => {
          // The poster shows the shift times, so it must be printed again after a change.
          toast.success(t("shiftForm.savedPoster"), {
            duration: 15_000,
            action: { label: t("shiftForm.openPoster"), onClick: openPoster },
          });
          onClose();
        },
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>
          {shift ? t("shiftForm.edit", { name: shift.name }) : t("shiftForm.new")}
        </DialogTitle>
        <DialogDescription>{t("shiftForm.desc", { plant: plantLabel })}</DialogDescription>
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

          <Field id="shift-name" label={t("shiftForm.name")}>
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
            <Field id="shift-start" label={t("shiftForm.start")}>
              <Input
                id="shift-start"
                type="time"
                step={60}
                value={start}
                className="tnum text-lg"
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field
              id="shift-end"
              label={t("shiftForm.end")}
              hint={timesGiven && endsNextDay(start, end) ? t("shiftForm.endsNextDay") : undefined}
              error={sameTimes ? t("errors.SHIFT_TIMES_INVALID") : undefined}
            >
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

          <div className="rounded-md border border-dashed bg-muted/50 p-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Lock className="size-4 text-muted-foreground" aria-hidden />
              {t("shiftForm.fullDayLabel")}
            </p>
            <p className="tnum text-lg font-bold">
              {fullDayMin > 0
                ? t("shiftForm.fullDayValue", { duration: formatDuration(fullDayMin) })
                : "–"}
            </p>
            <p className="text-[13px] text-muted-foreground">{t("shiftForm.fullDayNote")}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="shift-grace"
              label={t("shiftForm.grace")}
              hint={t("shiftForm.graceHint")}
              error={graceWrong ? t("shiftForm.error.grace") : undefined}
            >
              <div className="flex">
                <Input
                  id="shift-grace"
                  type="number"
                  min={0}
                  max={MAX_GRACE}
                  value={grace}
                  aria-invalid={graceWrong}
                  className="tnum rounded-r-none"
                  onChange={(event) => setGrace(event.target.value)}
                />
                <span className="grid place-items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                  {t("shiftForm.minutes")}
                </span>
              </div>
            </Field>
            <Field
              id="shift-half-hours"
              label={t("shiftForm.halfDay")}
              hint={t("shiftForm.halfDayHint")}
              error={
                halfDayWrong
                  ? t("shiftForm.error.halfDay", { fullDay: formatDuration(fullDayMin) })
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  id="shift-half-hours"
                  type="number"
                  min={0}
                  max={24}
                  value={halfHours}
                  aria-invalid={halfDayWrong}
                  className="tnum"
                  onChange={(event) => setHalfHours(event.target.value)}
                />
                <span className="text-sm text-muted-foreground">{t("shiftForm.hours")}</span>
                <Input
                  id="shift-half-minutes"
                  type="number"
                  min={0}
                  max={59}
                  aria-label={t("shiftForm.minutes")}
                  value={halfMinutes}
                  aria-invalid={halfDayWrong}
                  className="tnum"
                  onChange={(event) => setHalfMinutes(event.target.value)}
                />
                <span className="text-sm text-muted-foreground">{t("shiftForm.minutes")}</span>
              </div>
            </Field>
          </div>

          <Field
            id="shift-ot"
            label={t("shiftForm.overtimeMin")}
            hint={t("shiftForm.overtimeMinHint")}
          >
            <div className="flex">
              <Input
                id="shift-ot"
                type="number"
                min={0}
                max={MAX_OVERTIME_MIN}
                value={overtimeMin}
                aria-invalid={overtimeWrong}
                className="tnum rounded-r-none"
                onChange={(event) => setOvertimeMin(event.target.value)}
              />
              <span className="grid place-items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                {t("shiftForm.minutes")}
              </span>
            </div>
          </Field>

          {shift ? (
            <Field
              id="shift-rules-from"
              label={t("shiftForm.applyFrom")}
              hint={t("shiftForm.applyFromHint")}
              error={dateWrong ? t("shiftForm.error.applyFrom") : undefined}
            >
              <Input
                id="shift-rules-from"
                type="date"
                min={today}
                value={rulesFrom}
                aria-invalid={dateWrong}
                className="tnum"
                onChange={(event) => setRulesFrom(event.target.value)}
              />
            </Field>
          ) : null}

          {shift && !dateWrong && rulesFrom > today ? (
            <Alert tone="info">{t("shiftForm.futureNote", { date: formatDay(rulesFrom) })}</Alert>
          ) : null}

          {fullDayMin > 0 && !graceWrong && !halfDayWrong && !overtimeWrong ? (
            <ShiftHelper
              values={{ start, end, fullDayMin, graceMin, halfDayMin, overtimeMin: overtime }}
            />
          ) : fullDayMin === 0 ? (
            <p className="rounded-lg bg-primary-soft p-4 text-sm" aria-live="polite">
              {t("shiftForm.helperInvite")}
            </p>
          ) : null}

          {shift ? <RuleHistory shiftId={shift.id} /> : null}

          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              <Check aria-hidden />
              {t("shiftForm.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
