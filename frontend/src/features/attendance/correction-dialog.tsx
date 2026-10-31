// The dialog to correct one day (spec M5 §4.7, design gate B screen 5): choose what to do, fill the
// times or the status, give a reason, and see the day "before -> after" as the server works it
// out (the preview call stores nothing). The Super Admin saves at once; a Corporate Head or a Plant
// Head sends a request that the Super Admin decides. A refused preview (for example a time too
// near a real punch) is shown as a warning and the save button stays off.
import { ArrowRight, Check, Eye, Info, Loader, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { addDays } from "@/lib/dates";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clockText, formatDay, formatDuration } from "./attendance-format";
import { StatusChip } from "./status-chip";
import type { Day } from "./use-attendance-admin";
import {
  type CorrectionBody,
  type CorrectionKind,
  istToIso,
  type ShiftRules,
  type TimelineItem,
  useCreateCorrection,
  usePreviewCorrection,
} from "./use-day-detail";

const REASON_MIN = 3;
const REASON_MAX = 300;
const KIND_ORDER: CorrectionKind[] = ["add_punch", "add_in_out", "ignore_punch", "set_status"];
const STATUSES = ["present", "half_day", "absent"] as const;

/** A day in one line: status chip, IN, OUT and worked time. */
export function DayBrief({ day, tone }: { day: Day; tone?: "after" }) {
  const { t } = useTranslation();
  const dash = "–";
  return (
    <div
      className={cn(
        "min-w-0 flex-1 space-y-2 rounded-md border bg-card p-3",
        tone === "after" && "border-[#bfe3d2] bg-[#f3fbf7]",
      )}
    >
      <StatusChip day={day} />
      <p className="tnum flex flex-wrap gap-x-3 text-sm">
        <span>
          {t("corrections.in")} <b>{day.first_in ? formatTime(day.first_in) : dash}</b>
        </span>
        <span>
          {t("corrections.out")} <b>{day.last_out ? formatTime(day.last_out) : dash}</b>
        </span>
        <span>
          {t("attendance.day.result.worked")}{" "}
          <b>{day.worked_min > 0 ? formatDuration(day.worked_min) : dash}</b>
        </span>
      </p>
    </div>
  );
}

type Props = {
  employee: { id: string; name: string; code: string };
  date: string;
  kinds: CorrectionKind[];
  /** The Super Admin saves at once; everyone else sends a request. */
  canCorrect: boolean;
  timeline: TimelineItem[];
  shiftRules: ShiftRules | null;
  subtitle: string;
  /** A starting choice, for example "set_status" from a Short-hours day. */
  startKind?: CorrectionKind;
  onClose: () => void;
};

type Punch = Extract<TimelineItem, { kind: "punch" }>;

function usablePunches(timeline: TimelineItem[]): Punch[] {
  return timeline.filter(
    (item): item is Punch =>
      item.kind === "punch" && item.counts && item.ignored_by_correction_id === null,
  );
}

/** Which errors belong under the time fields; every other error goes above the buttons. */
function isTimeError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return code.startsWith("CORRECTION_TIME") || code === "CORRECTION_NEAR_PUNCH";
}

export function CorrectionDialog(props: Props) {
  const { t } = useTranslation();
  const { employee, date, canCorrect, timeline, shiftRules, onClose } = props;
  const punches = usablePunches(timeline);
  const kinds = KIND_ORDER.filter((kind) => props.kinds.includes(kind));
  const [kind, setKind] = useState<CorrectionKind>(
    props.startKind && kinds.includes(props.startKind)
      ? props.startKind
      : (kinds[0] ?? "add_punch"),
  );
  const startClock = shiftRules ? clockText(shiftRules.start_time) : "";
  const endClock = shiftRules ? clockText(shiftRules.end_time) : "";
  const endDate = shiftRules?.crosses_midnight ? addDays(date, 1) : date;
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [inDate, setInDate] = useState(date);
  const [inClock, setInClock] = useState(startClock);
  const [outDate, setOutDate] = useState(endDate);
  const [outClock, setOutClock] = useState(endClock);
  const [punchId, setPunchId] = useState(punches[0]?.punch_id ?? "");
  const [statusValue, setStatusValue] = useState<(typeof STATUSES)[number]>("present");
  const [reason, setReason] = useState("");

  const create = useCreateCorrection();
  const body = buildBody();
  // The server is asked only after the typing stops, and only when the form is complete.
  const [askedBody, setAskedBody] = useState<CorrectionBody | null>(null);
  const bodyText = JSON.stringify(body);
  // biome-ignore lint/correctness/useExhaustiveDependencies: bodyText stands for body
  useEffect(() => {
    const timer = setTimeout(() => setAskedBody(body), 300);
    return () => clearTimeout(timer);
  }, [bodyText]);
  const preview = usePreviewCorrection(askedBody);

  function buildBody(): CorrectionBody | null {
    const reasonLength = reason.trim().length;
    if (reasonLength < REASON_MIN || reasonLength > REASON_MAX) return null;
    const common = { employee_id: employee.id, attendance_date: date, kind, reason: reason.trim() };
    if (kind === "set_status") return { ...common, status_value: statusValue };
    if (kind === "ignore_punch") return punchId ? { ...common, punch_id: punchId } : null;
    const inTime = inDate && inClock ? istToIso(inDate, inClock) : undefined;
    const outTime = outDate && outClock ? istToIso(outDate, outClock) : undefined;
    if (kind === "add_in_out") {
      return inTime && outTime && outTime > inTime
        ? { ...common, in_time: inTime, out_time: outTime }
        : null;
    }
    if (direction === "in") return inTime ? { ...common, direction, in_time: inTime } : null;
    return outTime ? { ...common, direction, out_time: outTime } : null;
  }

  const save = () => {
    if (!body) return;
    create.mutate(body, {
      onSuccess: () => {
        toast.success(t(canCorrect ? "corrections.dialog.savedNow" : "corrections.dialog.sent"));
        onClose();
      },
    });
  };

  const previewIsCurrent = askedBody !== null && JSON.stringify(askedBody) === bodyText;
  const previewFailed = previewIsCurrent && preview.isError;
  const canSave = body !== null && previewIsCurrent && preview.isSuccess && !create.isPending;
  const timeError = previewFailed && isTimeError(preview.error) ? preview.error : create.error;
  const showsTimes = kind === "add_punch" || kind === "add_in_out";
  const showsIn = kind === "add_in_out" || (kind === "add_punch" && direction === "in");
  const showsOut = kind === "add_in_out" || (kind === "add_punch" && direction === "out");
  const timesLabelled = (label: string) => `${label}: ${t("corrections.dialog.dateAndTime")}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl p-0" aria-describedby={undefined}>
        <div className="border-b p-5 pr-12">
          <DialogTitle>
            {t(canCorrect ? "corrections.dialog.titleSuper" : "corrections.dialog.titleHead")}
          </DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>
        </div>

        <div className="space-y-4 p-5">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-bold">{t("corrections.dialog.what")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {KIND_ORDER.map((option) => {
                const allowed = kinds.includes(option);
                const noPunches = option === "ignore_punch" && punches.length === 0;
                const disabled = !allowed || noPunches;
                return (
                  <label
                    key={option}
                    className={cn(
                      "flex min-h-14 cursor-pointer gap-2.5 rounded-md border p-3",
                      kind === option && "border-primary bg-primary-soft ring-1 ring-primary",
                      disabled && "cursor-not-allowed bg-muted opacity-70",
                    )}
                  >
                    <input
                      type="radio"
                      name="correction-kind"
                      className="mt-1"
                      checked={kind === option}
                      disabled={disabled}
                      onChange={() => setKind(option)}
                    />
                    <span className="min-w-0 text-sm">
                      <b className="block">{t(`corrections.kind.${option}`)}</b>
                      <span className="text-muted-foreground">
                        {t(`corrections.kind.${option}Hint`)}
                      </span>
                      {noPunches ? (
                        <span className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
                          <Info className="size-3.5" aria-hidden />
                          {t("corrections.kind.ignoreDisabled")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {kind === "add_punch" ? (
            <div className="max-w-xs">
              <Label htmlFor="correction-direction">{t("corrections.dialog.direction")}</Label>
              <Select
                id="correction-direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value as "in" | "out")}
              >
                <option value="in">{t("corrections.in")}</option>
                <option value="out">{t("corrections.out")}</option>
              </Select>
            </div>
          ) : null}

          {showsTimes ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {showsIn ? (
                <TimeFields
                  idPrefix="in"
                  label={timesLabelled(t("corrections.in"))}
                  date={inDate}
                  clock={inClock}
                  onDate={setInDate}
                  onClock={setInClock}
                />
              ) : null}
              {showsOut ? (
                <div>
                  <TimeFields
                    idPrefix="out"
                    label={timesLabelled(t("corrections.out"))}
                    date={outDate}
                    clock={outClock}
                    onDate={setOutDate}
                    onClock={setOutClock}
                  />
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t("corrections.dialog.nightHint")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {kind === "ignore_punch" ? (
            <div>
              <Label htmlFor="correction-punch">{t("corrections.dialog.whichPunch")}</Label>
              <Select
                id="correction-punch"
                value={punchId}
                onChange={(event) => setPunchId(event.target.value)}
              >
                {punches.map((punch) => (
                  <option key={punch.punch_id} value={punch.punch_id}>
                    {formatTime(punch.punch_time)}{" "}
                    {punch.direction === "in" ? t("corrections.in") : t("corrections.out")}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {kind === "set_status" ? (
            <div className="max-w-xs">
              <Label htmlFor="correction-status">{t("corrections.dialog.statusLabel")}</Label>
              <Select
                id="correction-status"
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value as typeof statusValue)}
              >
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`corrections.status.${value}`)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {timeError && showsTimes ? (
            <p role="alert" className="text-[13px] font-medium text-destructive">
              {describeError(timeError, t)}
            </p>
          ) : null}

          <div>
            <Label htmlFor="correction-reason">{t("corrections.dialog.reason")}</Label>
            <Textarea
              id="correction-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="mt-1 flex justify-between text-[13px] text-muted-foreground">
              <span>{t("corrections.reasonRange")}</span>
              <span className="tnum">
                {reason.trim().length} / {REASON_MAX}
              </span>
            </p>
          </div>

          <section
            aria-label={t("corrections.dialog.preview")}
            className="space-y-3 rounded-md border border-dashed border-primary/50 p-3"
          >
            <p className="flex items-center justify-between gap-2 text-sm">
              <b className="flex items-center gap-1.5 text-primary">
                <Eye className="size-4" aria-hidden />
                {t("corrections.dialog.preview")}
              </b>
              <span className="text-[13px] text-muted-foreground">
                {t("corrections.serverResult")}
              </span>
            </p>
            {body === null ? (
              <p className="text-sm text-muted-foreground">{t("corrections.dialog.previewWait")}</p>
            ) : !previewIsCurrent || preview.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="size-4 animate-spin" aria-hidden />
                {t("corrections.dialog.previewLoading")}
              </p>
            ) : preview.isError ? (
              <Alert tone="warning">
                <TriangleAlert aria-hidden />
                <span>{describeError(preview.error, t)}</span>
              </Alert>
            ) : preview.data ? (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                    {t("corrections.before")}
                  </p>
                  <DayBrief day={preview.data.before} />
                </div>
                <ArrowRight
                  className="mx-auto size-5 shrink-0 rotate-90 text-primary sm:rotate-0"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                    {t("corrections.after")}
                  </p>
                  <DayBrief day={preview.data.after} tone="after" />
                </div>
              </div>
            ) : null}
            {preview.data?.warnings.map((warning) => (
              <Alert key={warning.code} tone="warning">
                <TriangleAlert aria-hidden />
                <span>{t(`attendanceExceptions.${warning.code}`)}</span>
              </Alert>
            ))}
          </section>

          <Alert>
            <Info aria-hidden />
            <span>
              {t(canCorrect ? "corrections.dialog.infoSuper" : "corrections.dialog.infoHead")}
            </span>
          </Alert>
          {create.isError && !(showsTimes && isTimeError(create.error)) ? (
            <Alert tone="danger">{describeError(create.error, t)}</Alert>
          ) : null}
        </div>

        <DialogFooter className="mt-0 border-t p-4">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSave} onClick={save}>
            <Check aria-hidden />
            {t(canCorrect ? "corrections.dialog.save" : "corrections.dialog.send")}
          </Button>
        </DialogFooter>
        <span className="sr-only">{formatDay(date)}</span>
      </DialogContent>
    </Dialog>
  );
}

function TimeFields(props: {
  idPrefix: string;
  label: string;
  date: string;
  clock: string;
  onDate: (value: string) => void;
  onClock: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-semibold">{props.label}</legend>
      <div className="flex gap-2">
        <Input
          type="date"
          aria-label={`${props.label} (date)`}
          value={props.date}
          onChange={(event) => props.onDate(event.target.value)}
        />
        <Input
          type="time"
          aria-label={`${props.label} (time)`}
          className="w-32"
          value={props.clock}
          onChange={(event) => props.onClock(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
