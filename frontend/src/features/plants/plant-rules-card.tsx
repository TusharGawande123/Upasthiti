// Weekly off and attendance start date of a plant (spec M5 §4.9, design gate C screen 3), shown
// in the plant's Overview tab. Only the Super Admin changes them; the others read. A weekly-off
// change never rewrites the past: it is a new entry that applies from today or a later date.
import { CalendarOff, Flag, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/features/attendance/attendance-format";
import { describeError } from "@/features/auth/error-message";
import { weeklyOffOn } from "@/features/leave/working-days";
import { addDays } from "@/lib/dates";
import { todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type Plant,
  useSetAttendanceStartDate,
  useSetWeeklyOff,
  useWeeklyOff,
  type WeeklyOffItem,
} from "./use-plants";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

type EntryState = "upcoming" | "inForce" | "earlier";

/** Newest first, and each entry told apart as upcoming, in force or earlier. */
function describeHistory(history: WeeklyOffItem[], today: string) {
  const newestFirst = [...history].sort(
    (a, b) =>
      b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at),
  );
  const inForceIndex = newestFirst.findIndex((item) => item.effective_from <= today);
  return newestFirst.map((item, index): { item: WeeklyOffItem; state: EntryState } => ({
    item,
    state:
      item.effective_from > today ? "upcoming" : index === inForceIndex ? "inForce" : "earlier",
  }));
}

function WeeklyOffDialog({
  plant,
  history,
  onClose,
}: {
  plant: Plant;
  history: WeeklyOffItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const save = useSetWeeklyOff(plant.id);
  const today = todayIst();
  const [weekday, setWeekday] = useState(weeklyOffOn(history, today));
  const [from, setFrom] = useState(today);
  const past = from !== "" && from < today;
  const oldWeekday = weeklyOffOn(history, from || today);
  const changes = weekday !== oldWeekday;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("plantWeekly.change")}</DialogTitle>
        <DialogDescription>{t("plantWeekly.dialogDesc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (past || from === "") return;
            save.mutate(
              { weekday, effective_from: from },
              {
                onSuccess: () => {
                  toast.success(t("plantWeekly.saved"));
                  onClose();
                },
              },
            );
          }}
        >
          {save.error ? (
            <Alert tone="danger">
              <span>{describeError(save.error, t)}</span>
            </Alert>
          ) : null}
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">{t("plantWeekly.weekday")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAYS.map((day) => (
                <label
                  key={day}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-sm font-semibold has-[:focus-visible]:ring-2",
                    day === weekday
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border-strong bg-card",
                  )}
                >
                  <input
                    type="radio"
                    name="weekly-off-day"
                    className="sr-only"
                    checked={day === weekday}
                    onChange={() => setWeekday(day)}
                  />
                  {t(`plantWeekly.day.${day}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field
            id="weekly-off-from"
            label={t("plantWeekly.applyFrom")}
            hint={t("plantWeekly.applyHint")}
            error={past ? t("plantWeekly.pastError") : undefined}
          >
            <Input
              id="weekly-off-from"
              type="date"
              min={today}
              value={from}
              className="tnum"
              aria-invalid={past}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          {changes && !past && from !== "" ? (
            <Alert tone="warning">
              {t("plantWeekly.warning", {
                date: formatDay(from),
                day: t(`plantWeekly.day.${weekday}`),
                old: t(`plantWeekly.day.${oldWeekday}`),
                plant: plant.code,
              })}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={past || from === "" || save.isPending}>
              {t("plantWeekly.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartDateDialog({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSetAttendanceStartDate(plant.id);
  const current = plant.attendance_start_date ?? null;
  const [date, setDate] = useState(current ?? todayIst());
  // Moving the date later hides the days in between; the server refuses a move to an earlier date
  // once attendance days exist (ATTENDANCE_START_INVALID).
  const movesLater = current !== null && date > current;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("plantStart.change")}</DialogTitle>
        <DialogDescription>{t("plantStart.dialogDesc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (date === "") return;
            save.mutate(date, {
              onSuccess: () => {
                toast.success(t("plantStart.saved"));
                onClose();
              },
            });
          }}
        >
          {save.error ? (
            <Alert tone="danger">
              <span>{describeError(save.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="start-date" label={t("plantStart.field")}>
            <Input
              id="start-date"
              type="date"
              value={date}
              className="tnum"
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          {movesLater && current ? (
            <Alert tone="warning">
              {t("plantStart.laterWarning", {
                from: formatDay(current),
                to: formatDay(addDays(date, -1)),
              })}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={date === "" || save.isPending}>
              {t("plantStart.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StateBadge({ state }: { state: EntryState }) {
  const { t } = useTranslation();
  if (state === "upcoming") return <Badge tone="warning">{t("plantWeekly.upcoming")}</Badge>;
  if (state === "inForce") return <Badge tone="primary">{t("plantWeekly.inForce")}</Badge>;
  return <Badge tone="neutral">{t("plantWeekly.earlier")}</Badge>;
}

export function PlantRulesCard({ plant, canEdit }: { plant: Plant; canEdit: boolean }) {
  const { t } = useTranslation();
  const weeklyOff = useWeeklyOff(plant.id);
  const [dialog, setDialog] = useState<"weekly" | "start" | null>(null);
  const today = todayIst();

  const history = weeklyOff.data?.history ?? [];
  const entries = describeHistory(history, today);
  const inForce = entries.find((entry) => entry.state === "inForce")?.item ?? null;
  const upcoming = entries.find((entry) => entry.state === "upcoming")?.item ?? null;
  const startDate = plant.attendance_start_date ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("plantWeekly.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {weeklyOff.isError ? (
          <Alert tone="danger">{describeError(weeklyOff.error, t)}</Alert>
        ) : weeklyOff.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-2 text-lg font-bold">
                <CalendarOff className="size-5 text-muted-foreground" aria-hidden />
                {inForce ? (
                  <span>
                    {t(`plantWeekly.day.${inForce.weekday}`)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {t("plantWeekly.from", { date: formatDay(inForce.effective_from) })}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm font-normal">{t("plantWeekly.notSet")}</span>
                )}
              </p>
              {upcoming ? (
                <p className="text-sm font-semibold text-warning">
                  {t("plantWeekly.upcomingNote", {
                    day: t(`plantWeekly.day.${upcoming.weekday}`),
                    date: formatDay(upcoming.effective_from),
                    old: t(`plantWeekly.day.${weeklyOffOn(history, today)}`),
                  })}
                </p>
              ) : null}
              {entries.length > 0 ? (
                <div>
                  <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    {t("plantWeekly.history")}
                  </p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {entries.map(({ item, state }) => (
                      <li
                        key={`${item.effective_from}-${item.created_at}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <strong>
                          {t("plantWeekly.row", { date: formatDay(item.effective_from) })}
                        </strong>
                        <span>{t(`plantWeekly.day.${item.weekday}`)}</span>
                        <StateBadge state={state} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {canEdit ? (
              <Button variant="outline" onClick={() => setDialog("weekly")}>
                <Pencil aria-hidden />
                {t("plantWeekly.change")}
              </Button>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-5">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Flag className="size-4" aria-hidden />
              {t("plantStart.title")}
            </p>
            <p className="text-lg font-bold tnum">
              {startDate ? formatDay(startDate) : t("plantStart.notSet")}
            </p>
            <p className="max-w-md text-[13px] text-muted-foreground">{t("plantStart.hint")}</p>
          </div>
          {canEdit ? (
            <Button variant="outline" onClick={() => setDialog("start")}>
              <Pencil aria-hidden />
              {t("plantStart.change")}
            </Button>
          ) : null}
        </div>
      </CardContent>

      {dialog === "weekly" ? (
        <WeeklyOffDialog plant={plant} history={history} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "start" ? (
        <StartDateDialog plant={plant} onClose={() => setDialog(null)} />
      ) : null}
    </Card>
  );
}
