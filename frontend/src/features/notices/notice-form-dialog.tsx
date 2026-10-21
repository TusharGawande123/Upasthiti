// The gate notice form (new or edit, spec M2 §4.11, design gate C): plant, text with a counter,
// level, start and end in IST, and a live preview made with the kiosk's own notices panel, so what
// you see is what the workers see. The server checks everything again (NOTICE_TEXT_INVALID,
// NOTICE_DATES_INVALID, NOTICE_ENDED...); the checks here only save a round trip.
import { Check, Clock3, Info, Megaphone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { NoticesPanel } from "@/kiosk/attendance/notices-panel";
import { istDateAndTime, istToIso } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { type Notice, type NoticeLevel, useCreateNotice, useUpdateNotice } from "./use-notices";

const MAX_TEXT = 200;
const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

type PlantOption = { id: string; code: string; name: string };

/** Text on one line: line breaks typed or pasted become spaces. */
export function oneLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ");
}

export type NoticeFormValues = {
  plantId: string; // "" = every plant
  text: string;
  level: NoticeLevel;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

/** The first problem with the form, as a translation key, or null when it can be saved. */
export function formProblem(values: NoticeFormValues, nowMs: number): string | null {
  const text = values.text.trim();
  if (text.length < 1 || text.length > MAX_TEXT) return "notices.error.text";
  const start = Date.parse(istToIso(values.startDate, values.startTime));
  const end = Date.parse(istToIso(values.endDate, values.endTime));
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start)
    return "notices.error.endBeforeStart";
  if (end - start > MAX_DAYS * DAY_MS) return "notices.error.tooLong";
  if (end <= nowMs) return "notices.error.endPast";
  return null;
}

function initialValues(notice: Notice | null, fixedPlantId: string | null): NoticeFormValues {
  if (notice) {
    const start = istDateAndTime(notice.starts_at);
    const end = istDateAndTime(notice.ends_at);
    return {
      plantId: notice.plant?.id ?? "",
      text: notice.text,
      level: notice.level,
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    };
  }
  // A new notice shows from now until the end of today.
  const now = istDateAndTime(new Date());
  return {
    plantId: fixedPlantId ?? "",
    text: "",
    level: "normal",
    startDate: now.date,
    startTime: now.time,
    endDate: now.date,
    endTime: "23:59",
  };
}

export function NoticeFormDialog({
  notice,
  plants,
  fixedPlantId,
  onClose,
}: {
  /** The notice to edit, or null for a new one. */
  notice: Notice | null;
  plants: PlantOption[];
  /** A Plant Head can write only for their own plant: that plant, and no "All plants". */
  fixedPlantId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateNotice();
  const update = useUpdateNotice(notice?.id ?? "");
  const [values, setValues] = useState(() => initialValues(notice, fixedPlantId));
  const [showProblem, setShowProblem] = useState(false);
  const set = <Key extends keyof NoticeFormValues>(key: Key, value: NoticeFormValues[Key]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const problem = formProblem(values, Date.now());
  const saving = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;
  const plantName =
    plants.find((plant) => plant.id === values.plantId)?.name ?? t("notices.allPlants");

  const save = () => {
    if (problem) {
      setShowProblem(true);
      return;
    }
    const body = {
      text: values.text.trim(),
      level: values.level,
      starts_at: istToIso(values.startDate, values.startTime),
      ends_at: istToIso(values.endDate, values.endTime),
    };
    const done = { onSuccess: onClose };
    if (notice) update.mutate(body, done);
    else create.mutate({ ...body, plant_id: values.plantId || null }, done);
  };

  const quick = (label: string, change: Partial<NoticeFormValues>) => (
    <Button size="sm" variant="outline" onClick={() => setValues((c) => ({ ...c, ...change }))}>
      {label}
    </Button>
  );
  const today = istDateAndTime(new Date()).date;
  const preview = {
    id: "preview",
    text: values.text.trim() || t("notices.form.previewEmpty"),
    level: values.level,
    ends_at: istToIso(values.endDate, values.endTime),
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="flex items-center gap-2">
          <Megaphone className="size-5" aria-hidden />
          {notice ? t("notices.form.editTitle") : t("notices.form.newTitle")}
        </DialogTitle>
        <DialogDescription>{t("notices.form.explain")}</DialogDescription>
        <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {serverError ? (
              <Alert tone="danger">
                <span>{describeError(serverError, t)}</span>
              </Alert>
            ) : null}
            <Field id="notice-plant" label={t("notices.form.plant")}>
              <Select
                id="notice-plant"
                value={values.plantId}
                disabled={fixedPlantId !== null || notice !== null}
                onChange={(event) => set("plantId", event.target.value)}
              >
                {fixedPlantId === null ? <option value="">{t("notices.allPlants")}</option> : null}
                {plants.map((plant) => (
                  <option key={plant.id} value={plant.id}>
                    {plant.code} · {plant.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="notice-text"
              label={t("notices.form.text")}
              hint={t("notices.form.textHint")}
            >
              <textarea
                id="notice-text"
                value={values.text}
                rows={3}
                onChange={(event) => set("text", oneLine(event.target.value))}
                onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              />
              <p
                className={cn(
                  "tnum text-right text-xs",
                  values.text.length > MAX_TEXT
                    ? "font-bold text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {values.text.length}/{MAX_TEXT}
              </p>
            </Field>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1 text-sm font-medium">{t("notices.form.level")}</legend>
              {(["normal", "important"] as const).map((level) => (
                <label
                  key={level}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                    values.level === level && "border-primary bg-primary-soft",
                  )}
                >
                  <input
                    type="radio"
                    name="notice-level"
                    value={level}
                    checked={values.level === level}
                    onChange={() => set("level", level)}
                    className="mt-1"
                  />
                  <span>
                    <b className="flex items-center gap-1">
                      {level === "important" ? (
                        <TriangleAlert className="size-4" aria-hidden />
                      ) : null}
                      {t(`notices.level.${level}`)}
                    </b>
                    <span className="text-muted-foreground">{t(`notices.form.${level}Hint`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field id="notice-start-date" label={t("notices.form.startDate")}>
                <Input
                  id="notice-start-date"
                  type="date"
                  value={values.startDate}
                  onChange={(event) => set("startDate", event.target.value)}
                />
              </Field>
              <Field id="notice-start-time" label={t("notices.form.startTime")}>
                <Input
                  id="notice-start-time"
                  type="time"
                  value={values.startTime}
                  onChange={(event) => set("startTime", event.target.value)}
                />
              </Field>
              <Field id="notice-end-date" label={t("notices.form.endDate")}>
                <Input
                  id="notice-end-date"
                  type="date"
                  value={values.endDate}
                  onChange={(event) => set("endDate", event.target.value)}
                />
              </Field>
              <Field id="notice-end-time" label={t("notices.form.endTime")}>
                <Input
                  id="notice-end-time"
                  type="time"
                  value={values.endTime}
                  onChange={(event) => set("endTime", event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {quick(t("notices.form.untilTonight"), { endDate: today, endTime: "23:59" })}
              {quick(t("notices.form.sevenDays"), {
                endDate: istDateAndTime(new Date(Date.now() + 7 * DAY_MS)).date,
                endTime: "23:59",
              })}
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("notices.form.datesHint", { days: MAX_DAYS })}
            </p>
            {showProblem && problem ? (
              <Alert tone="warning">
                <span>{t(problem)}</span>
              </Alert>
            ) : null}
          </form>

          <aside aria-label={t("notices.form.preview")} className="space-y-3">
            <h3 className="text-xs font-bold text-muted-foreground uppercase">
              {t("notices.form.preview")}
            </h3>
            <div className="kiosk-theme rounded-xl border-4 border-foreground bg-background p-4">
              <NoticesPanel notices={[preview]} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("notices.form.previewNote", { where: plantName })}
            </p>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("notices.form.within")}
            </p>
          </aside>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            <Check aria-hidden />
            {t("notices.form.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
