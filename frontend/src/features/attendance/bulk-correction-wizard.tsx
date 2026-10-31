// The wizard "Correct many people" (F-59, spec M5 §4.7, design gate B screen 5), used after a gate
// outage. Five steps: plant and day, what to add, people, reason, preview. The preview shows what
// would change for each person and who would be skipped (and why); nothing is stored until the last
// button. The Super Admin's corrections are approved at once; the heads' are sent as requests.
// Up to 200 people. Afterwards the Super Admin can reverse the whole batch (reason required).
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CircleCheck,
  CircleSlash,
  Info,
  Layers,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useEmployees } from "@/features/employees/use-employees";
import { usePlants } from "@/features/plants/use-plants";
import { apiGet } from "@/lib/api-client";
import { formatTime, todayIst } from "@/lib/format";
import { type Page, queryString } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDay, formatDuration } from "./attendance-format";
import { StatusChip } from "./status-chip";
import type { DailyItem } from "./use-attendance-admin";
import {
  type BulkBody,
  type BulkCreated,
  istToIso,
  useBatchAction,
  useBulkCreate,
  useBulkPreview,
} from "./use-day-detail";

const MAX_PEOPLE = 200;
const REASON_MIN = 3;
const REASON_MAX = 300;
const STEPS = ["plantDay", "what", "people", "reason", "preview"] as const;

type WhatToAdd = "in_out" | "in" | "out";
type Chosen = { id: string; code: string; name: string };

type Props = { isSuperAdmin: boolean; onClose: () => void };

function Stepper({ step, done }: { step: number; done: boolean }) {
  const { t } = useTranslation();
  return (
    <ol className="mb-4 grid grid-cols-5 gap-1">
      {STEPS.map((name, index) => {
        const finished = done || index + 1 < step;
        const current = !done && index + 1 === step;
        return (
          <li
            key={name}
            aria-current={current ? "step" : undefined}
            className="flex min-w-0 flex-col items-center gap-1 text-center text-xs font-semibold"
          >
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full border-2",
                finished && "border-primary bg-primary text-primary-foreground",
                current && "border-primary text-primary",
              )}
            >
              {finished ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>
            <span className={cn("hidden sm:block", current && "text-foreground")}>
              {t(`corrections.bulk.step.${name}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function BulkCorrectionWizard({ isSuperAdmin, onClose }: Props) {
  const { t } = useTranslation();
  const plants = usePlants({ is_active: true });
  const [step, setStep] = useState(1);
  const [plantId, setPlantId] = useState("");
  const [date, setDate] = useState(todayIst());
  const [what, setWhat] = useState<WhatToAdd>("in_out");
  const [inClock, setInClock] = useState("09:00");
  const [outClock, setOutClock] = useState("17:00");
  const [outDate, setOutDate] = useState(todayIst());
  const [chosen, setChosen] = useState<Map<string, Chosen>>(new Map());
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkCreated | null>(null);
  const [reversing, setReversing] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reversedCount, setReversedCount] = useState<number | null>(null);

  const preview = useBulkPreview();
  const create = useBulkCreate();
  const batch = useBatchAction();
  const plantList = plants.data?.items ?? [];
  // A Plant Head sees only the own plant; with one plant there is nothing to choose.
  const effectivePlantId = plantId || (plantList.length === 1 ? (plantList[0]?.id ?? "") : "");
  const people = useEmployees({
    plant_id: effectivePlantId,
    status: "active",
    q: search || undefined,
    page: 1,
    page_size: 100,
  });

  const body = (): BulkBody => {
    const base = {
      plant_id: effectivePlantId,
      attendance_date: date,
      employee_ids: [...chosen.keys()],
      reason: reason.trim(),
    };
    const inTime = istToIso(date, inClock);
    const outTime = istToIso(outDate, outClock);
    if (what === "in_out") {
      return { ...base, kind: "add_in_out", in_time: inTime, out_time: outTime };
    }
    if (what === "in") return { ...base, kind: "add_punch", direction: "in", in_time: inTime };
    return { ...base, kind: "add_punch", direction: "out", out_time: outTime };
  };

  const stepIsValid = (): boolean => {
    if (step === 1) return effectivePlantId !== "" && date !== "" && date <= todayIst();
    if (step === 2) {
      const needsIn = what !== "out" && inClock !== "";
      const needsOut = what !== "in" && outClock !== "";
      const orderOk = what !== "in_out" || istToIso(outDate, outClock) > istToIso(date, inClock);
      return (what === "out" || needsIn) && (what === "in" || needsOut) && orderOk;
    }
    if (step === 3) return chosen.size >= 1 && chosen.size <= MAX_PEOPLE;
    if (step === 4) return reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
    return true;
  };

  const goTo = (next: number) => {
    setStep(next);
    if (next === 5) preview.mutate(body());
  };

  const toggle = (person: Chosen) => {
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(person.id)) next.delete(person.id);
      else if (next.size < MAX_PEOPLE) next.set(person.id, person);
      return next;
    });
  };

  const chooseAbsent = async () => {
    const answer = await apiGet<Page<DailyItem>>(
      `/attendance/daily${queryString({
        date,
        plant_id: effectivePlantId,
        status: "absent",
        page_size: MAX_PEOPLE,
      })}`,
    );
    setChosen((current) => {
      const next = new Map(current);
      for (const item of answer.items) {
        if (next.size < MAX_PEOPLE) {
          next.set(item.employee.id, {
            id: item.employee.id,
            code: item.employee.code,
            name: item.employee.name,
          });
        }
      }
      return next;
    });
  };

  const send = () =>
    create.mutate(body(), {
      onSuccess: (answer) => {
        setResult(answer);
        toast.success(
          t(isSuperAdmin ? "corrections.bulk.doneSuper" : "corrections.bulk.doneHead", {
            count: answer.created,
          }),
        );
      },
    });

  const reverse = () =>
    result &&
    batch.mutate(
      { batchId: result.batch_id, action: "reverse", reason: reverseReason.trim() },
      { onSuccess: (answer) => setReversedCount(answer.reversed ?? 0) },
    );

  const plantName = plantList.find((plant) => plant.id === effectivePlantId)?.code ?? "";
  const summary = t("corrections.bulk.summary", {
    plant: plantName,
    date: formatDay(date),
    what: t(`corrections.bulk.what.${what}`, {
      inTime: inClock,
      outTime: outClock,
    }),
    reason: reason.trim(),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-3xl flex-col p-0">
        <div className="border-b p-5 pr-12">
          <DialogTitle>{t("corrections.bulk.title")}</DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {result ? t("corrections.bulk.finished") : t("corrections.bulk.stepOf", { step })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <Stepper step={step} done={result !== null} />

          {result ? (
            <DoneBlock
              result={result}
              isSuperAdmin={isSuperAdmin}
              summary={summary}
              reversing={reversing}
              reversedCount={reversedCount}
              reverseReason={reverseReason}
              setReverseReason={setReverseReason}
              onStartReverse={() => setReversing(true)}
              onReverse={reverse}
              reversePending={batch.isPending}
              reverseError={batch.error}
            />
          ) : null}

          {!result && step === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="bulk-plant" label={t("attendance.filter.plant")}>
                <Select
                  id="bulk-plant"
                  value={effectivePlantId}
                  onChange={(event) => {
                    setPlantId(event.target.value);
                    setChosen(new Map());
                  }}
                >
                  <option value="">{t("corrections.bulk.choosePlant")}</option>
                  {plantList.map((plant) => (
                    <option key={plant.id} value={plant.id}>
                      {plant.code} · {plant.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="bulk-date" label={t("attendance.filter.date")}>
                <Input
                  id="bulk-date"
                  type="date"
                  max={todayIst()}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setOutDate(event.target.value);
                  }}
                />
              </Field>
            </div>
          ) : null}

          {!result && step === 2 ? (
            <div className="space-y-4">
              <fieldset className="grid gap-2 sm:grid-cols-3">
                <legend className="mb-2 text-sm font-bold">{t("corrections.dialog.what")}</legend>
                {(["in_out", "in", "out"] as const).map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-semibold",
                      what === option && "border-primary bg-primary-soft ring-1 ring-primary",
                    )}
                  >
                    <input
                      type="radio"
                      name="bulk-what"
                      checked={what === option}
                      onChange={() => setWhat(option)}
                    />
                    {t(`corrections.bulk.option.${option}`)}
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                {what !== "out" ? (
                  <Field id="bulk-in" label={t("corrections.bulk.inTime")}>
                    <Input
                      id="bulk-in"
                      type="time"
                      value={inClock}
                      onChange={(event) => setInClock(event.target.value)}
                    />
                  </Field>
                ) : null}
                {what !== "in" ? (
                  <Field
                    id="bulk-out"
                    label={t("corrections.bulk.outTime")}
                    hint={t("corrections.dialog.nightHint")}
                  >
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        aria-label={t("corrections.bulk.outDate")}
                        value={outDate}
                        min={date}
                        onChange={(event) => setOutDate(event.target.value)}
                      />
                      <Input
                        id="bulk-out"
                        type="time"
                        className="w-32"
                        value={outClock}
                        onChange={(event) => setOutClock(event.target.value)}
                      />
                    </div>
                  </Field>
                ) : null}
              </div>
            </div>
          ) : null}

          {!result && step === 3 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field id="bulk-search" label={t("attendance.filter.search")}>
                    <Input
                      id="bulk-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </Field>
                </div>
                <Button variant="outline" onClick={chooseAbsent}>
                  {t("corrections.bulk.chooseAbsent")}
                </Button>
              </div>
              <p className="text-sm font-semibold">
                {t("corrections.bulk.chosenCount", { count: chosen.size, max: MAX_PEOPLE })}
              </p>
              {people.isPending ? <Skeleton className="h-40" /> : null}
              {people.isError ? (
                <Alert tone="danger">{describeError(people.error, t)}</Alert>
              ) : null}
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {people.data?.items.map((person) => (
                  <li key={person.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={chosen.has(person.id)}
                        onChange={() =>
                          toggle({
                            id: person.id,
                            code: person.employee_code,
                            name: person.full_name,
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {person.full_name}
                      </span>
                      <span className="code text-muted-foreground">{person.employee_code}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {chosen.size >= MAX_PEOPLE ? (
                <Alert tone="warning">
                  {t("corrections.bulk.limitReached", { max: MAX_PEOPLE })}
                </Alert>
              ) : null}
            </div>
          ) : null}

          {!result && step === 4 ? (
            <Field
              id="bulk-reason"
              label={t("corrections.dialog.reason")}
              hint={t("corrections.reasonRange")}
            >
              <Textarea
                id="bulk-reason"
                value={reason}
                maxLength={REASON_MAX}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          ) : null}

          {!result && step === 5 ? (
            <PreviewBlock
              summary={summary}
              state={preview}
              total={chosen.size}
              createError={create.error}
            />
          ) : null}
        </div>

        <DialogFooter className="mt-0 border-t p-4">
          {result ? (
            <Button onClick={onClose}>
              <Check aria-hidden />
              {t("common.done")}
            </Button>
          ) : (
            <>
              {step > 1 ? (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  <ArrowLeft aria-hidden />
                  {t("corrections.bulk.back")}
                </Button>
              ) : (
                <Button variant="outline" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
              )}
              {step < 5 ? (
                <Button disabled={!stepIsValid()} onClick={() => goTo(step + 1)}>
                  {t("corrections.bulk.next")}
                  <ArrowRight aria-hidden />
                </Button>
              ) : (
                <Button
                  disabled={!preview.data || preview.data.will_create === 0 || create.isPending}
                  onClick={send}
                >
                  <CheckCheck aria-hidden />
                  {t(isSuperAdmin ? "corrections.bulk.createSuper" : "corrections.bulk.sendHead", {
                    count: preview.data?.will_create ?? 0,
                  })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBlock({
  summary,
  state,
  total,
  createError,
}: {
  summary: string;
  state: ReturnType<typeof useBulkPreview>;
  total: number;
  createError: unknown;
}) {
  const { t } = useTranslation();
  if (state.isPending) {
    return (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("corrections.dialog.previewLoading")}</p>
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (state.isError) return <Alert tone="danger">{describeError(state.error, t)}</Alert>;
  if (!state.data) return null;
  const { items, will_create: willCreate, will_skip: willSkip } = state.data;
  return (
    <div className="space-y-3">
      <Alert>
        <Info aria-hidden />
        <span>{summary}</span>
      </Alert>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-md border border-[#bfe3d2] bg-[#e6f5ee] p-3">
          <b className="block text-2xl text-[#04694b]">{willCreate}</b>
          {t("corrections.bulk.willChange")}
        </div>
        <div className="rounded-md border border-[#f1d18a] bg-[#fff3d6] p-3">
          <b className="block text-2xl text-[#8f5300]">{willSkip}</b>
          {t("corrections.bulk.willSkip")}
        </div>
        <div className="rounded-md border bg-card p-3">
          <b className="block text-2xl">{total}</b>
          {t("corrections.bulk.chosen")}
        </div>
      </div>
      <ul className="divide-y rounded-md border">
        {items.map((item) => (
          <li
            key={item.employee.id}
            className={cn("space-y-1.5 p-3 text-sm", item.skip_code && "bg-[#fffaf0]")}
          >
            <p className="flex flex-wrap items-baseline gap-2">
              <b>{item.employee.name}</b>
              <span className="code text-xs text-muted-foreground">{item.employee.code}</span>
            </p>
            {item.skip_code ? (
              <p className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md border border-[#f1d18a] bg-[#fff3d6] px-2 py-0.5 text-xs font-semibold text-[#8f5300]">
                  <CircleSlash className="size-3" aria-hidden />
                  {t("corrections.bulk.skipped")}
                </span>
                <span className="code text-xs">{item.skip_code}</span>
                <span className="text-muted-foreground">
                  {t(`corrections.skipReason.${item.skip_code}`, {
                    defaultValue: t(`errors.${item.skip_code}`, {
                      defaultValue: t("errors.UNKNOWN"),
                    }),
                  })}
                </span>
              </p>
            ) : item.before && item.after ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip day={item.before} />
                <ArrowRight className="size-4 text-primary" aria-hidden />
                <StatusChip day={item.after} />
                <span className="tnum text-muted-foreground">
                  {item.after.first_in ? formatTime(item.after.first_in) : "–"} –{" "}
                  {item.after.last_out ? formatTime(item.after.last_out) : "–"}
                </span>
                <b className="tnum">{formatDuration(item.after.worked_min)}</b>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {createError ? <Alert tone="danger">{describeError(createError, t)}</Alert> : null}
    </div>
  );
}

function DoneBlock(props: {
  result: BulkCreated;
  isSuperAdmin: boolean;
  summary: string;
  reversing: boolean;
  reversedCount: number | null;
  reverseReason: string;
  setReverseReason: (value: string) => void;
  onStartReverse: () => void;
  onReverse: () => void;
  reversePending: boolean;
  reverseError: unknown;
}) {
  const { t } = useTranslation();
  const { result } = props;
  const reasonLength = props.reverseReason.trim().length;
  return (
    <div className="space-y-4">
      <div className="space-y-2 py-2 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full border border-[#bfe3d2] bg-[#e6f5ee] text-[#04694b]">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <h3 className="text-lg font-bold">
          {t(props.isSuperAdmin ? "corrections.bulk.doneSuper" : "corrections.bulk.doneHead", {
            count: result.created,
          })}
        </h3>
        {result.skipped.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("corrections.bulk.skippedCount", { count: result.skipped.length })}
          </p>
        ) : null}
      </div>
      {result.skipped.length > 0 ? (
        <ul className="space-y-1 rounded-md border p-3 text-sm">
          {result.skipped.map((item) => (
            <li key={item.employee_id} className="flex flex-wrap gap-2">
              <span className="code text-xs">{item.code}</span>
              <span className="text-muted-foreground">
                {t(`corrections.skipReason.${item.code}`, {
                  defaultValue: t(`errors.${item.code}`, { defaultValue: t("errors.UNKNOWN") }),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Layers className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">{props.summary}</p>
      </div>
      {props.isSuperAdmin && result.created > 0 ? (
        props.reversedCount !== null ? (
          <Alert>
            <Undo2 aria-hidden />
            <span>{t("corrections.bulk.reversed", { count: props.reversedCount })}</span>
          </Alert>
        ) : props.reversing ? (
          <div className="space-y-3">
            <Alert tone="warning">
              <span>{t("corrections.bulk.reverseWarn", { count: result.created })}</span>
            </Alert>
            <Field
              id="batch-reverse-reason"
              label={t("corrections.reverseReason")}
              hint={t("corrections.reasonRange")}
            >
              <Textarea
                id="batch-reverse-reason"
                value={props.reverseReason}
                maxLength={REASON_MAX}
                onChange={(event) => props.setReverseReason(event.target.value)}
              />
            </Field>
            {props.reverseError ? (
              <Alert tone="danger">{describeError(props.reverseError, t)}</Alert>
            ) : null}
            <Button
              variant="danger"
              disabled={
                reasonLength < REASON_MIN || reasonLength > REASON_MAX || props.reversePending
              }
              onClick={props.onReverse}
            >
              <Undo2 aria-hidden />
              {t("corrections.bulk.reverseBatch")}
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={props.onStartReverse}>
            <Undo2 aria-hidden />
            {t("corrections.bulk.reverseBatch")}
          </Button>
        )
      ) : null}
    </div>
  );
}
