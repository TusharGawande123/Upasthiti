// The two windows of the data-request register: "Add request" and the sheet of one request with
// its steps (append-only, so there is no edit and no delete). Super Admin only.
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
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { type Employee, useEmployees } from "@/features/employees/use-employees";
import { formatDate, formatTime, todayIst } from "@/lib/format";
import {
  CHANNELS,
  type Channel,
  type EventType,
  nextSteps,
  OUTCOMES,
  type Outcome,
  REQUEST_KINDS,
  type RequestKind,
  useAddRequestEvent,
  useCreateDataRequest,
  useDataRequest,
} from "./use-data-requests";

const NOTE_MAX = 300;
const REASON_MIN = 10;

function PersonPicker({
  person,
  onPick,
}: {
  person: Employee | null;
  onPick: (employee: Employee | null) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const people = useEmployees({ q: search.trim() || undefined, page: 1, page_size: 20 });

  if (person) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
        <span>
          <strong>{person.full_name}</strong> · {person.employee_code}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
          {t("privacyRequests.add.changePerson")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input
        id="request-person"
        type="search"
        autoComplete="off"
        placeholder={t("privacyRequests.add.searchPerson")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {search.trim() ? (
        <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
          {people.data?.items.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => onPick(candidate)}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{candidate.full_name}</span>
                <span className="code text-muted-foreground">{candidate.employee_code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AddRequestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateDataRequest();
  const [kind, setKind] = useState<RequestKind>("access");
  const [person, setPerson] = useState<Employee | null>(null);
  const [channel, setChannel] = useState<Channel>("in_person");
  const [receivedOn, setReceivedOn] = useState(todayIst());
  const [note, setNote] = useState("");

  const dateWrong = receivedOn === "" || receivedOn > todayIst();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{t("privacyRequests.add.title")}</DialogTitle>
        <DialogDescription>{t("privacyRequests.add.desc")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (dateWrong) return;
            create.mutate(
              {
                kind,
                channel,
                received_on: receivedOn,
                employee_id: person?.id,
                note: note.trim() || undefined,
              },
              {
                onSuccess: () => {
                  toast.success(t("privacyRequests.toast.added"));
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="request-kind" label={t("privacyRequests.field.kind")}>
              <Select
                id="request-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as RequestKind)}
              >
                {REQUEST_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`privacyRequests.kind.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="request-channel" label={t("privacyRequests.field.channel")}>
              <Select
                id="request-channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value as Channel)}
              >
                {CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`privacyRequests.channel.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            id="request-person"
            label={t("privacyRequests.field.person")}
            hint={t("privacyRequests.field.personHint")}
          >
            <PersonPicker person={person} onPick={setPerson} />
          </Field>
          <Field
            id="request-received"
            label={t("privacyRequests.field.receivedOn")}
            error={dateWrong ? t("privacyRequests.error.receivedOn") : undefined}
          >
            <Input
              id="request-received"
              type="date"
              value={receivedOn}
              max={todayIst()}
              className="tnum"
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </Field>
          <Field
            id="request-note"
            label={t("privacyRequests.field.note")}
            hint={t("privacyRequests.field.noteHint")}
          >
            <Textarea
              id="request-note"
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={dateWrong || create.isPending}>
              {t("privacyRequests.add.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StepForm({
  requestId,
  steps,
  isErasure,
}: {
  requestId: string;
  steps: EventType[];
  isErasure: boolean;
}) {
  const { t } = useTranslation();
  const add = useAddRequestEvent(requestId);
  const [step, setStep] = useState<EventType>(steps[0] ?? "identity_checked");
  const [detail, setDetail] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(isErasure ? "partly_done" : "done");

  const chosen = steps.includes(step) ? step : (steps[0] ?? step);
  const needsReason = chosen === "closed" && outcome !== "done";
  const detailLength = detail.trim().length;
  const valid = detailLength >= (needsReason ? REASON_MIN : 1);

  return (
    <form
      className="space-y-3 rounded-lg border bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        add.mutate(
          {
            event_type: chosen,
            detail: detail.trim(),
            outcome: chosen === "closed" ? outcome : undefined,
          },
          {
            onSuccess: () => {
              toast.success(t("privacyRequests.toast.stepAdded"));
              setDetail("");
            },
          },
        );
      }}
    >
      <h3 className="font-bold">{t("privacyRequests.step.addTitle")}</h3>
      {add.error ? (
        <Alert tone="danger">
          <span>{describeError(add.error, t)}</span>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="step-type" label={t("privacyRequests.step.type")}>
          <Select
            id="step-type"
            value={chosen}
            onChange={(event) => setStep(event.target.value as EventType)}
          >
            {steps.map((value) => (
              <option key={value} value={value}>
                {t(`privacyRequests.event.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {chosen === "closed" ? (
          <Field id="step-outcome" label={t("privacyRequests.step.outcome")}>
            <Select
              id="step-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as Outcome)}
            >
              {OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {t(`privacyRequests.outcome.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <Field
        id="step-detail"
        label={t(needsReason ? "privacyRequests.step.reason" : "privacyRequests.step.detail")}
        hint={t(`privacyRequests.step.hint.${chosen}`)}
      >
        <Textarea
          id="step-detail"
          value={detail}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(event) => setDetail(event.target.value)}
        />
      </Field>
      {chosen === "closed" && isErasure ? (
        <p className="text-[13px] text-muted-foreground">{t("privacyRequests.step.keptRecords")}</p>
      ) : null}
      <Button type="submit" disabled={!valid || add.isPending}>
        {t("privacyRequests.step.submit")}
      </Button>
    </form>
  );
}

export function RequestSheet({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const request = useDataRequest(requestId);
  const data = request.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t("privacyRequests.sheet.title")}</DialogTitle>
        <DialogDescription>{t("privacyRequests.sheet.desc")}</DialogDescription>
        {request.isError ? (
          <Alert tone="danger" className="mt-4">
            <span>{describeError(request.error, t)}</span>
          </Alert>
        ) : null}
        {request.isPending ? <Skeleton className="mt-4 h-24 w-full" /> : null}
        {data ? (
          <div className="mt-4 space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t("privacyRequests.field.kind")}</dt>
                <dd>{t(`privacyRequests.kind.${data.kind}`)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("privacyRequests.field.person")}</dt>
                <dd>
                  {data.employee_code
                    ? `${data.employee_name} · ${data.employee_code}`
                    : t("privacyRequests.notEmployee")}
                  {data.employee_left ? (
                    <Badge tone="neutral" className="ml-2">
                      {t("privacyRequests.left")}
                    </Badge>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t("privacyRequests.field.channel")}</dt>
                <dd>{t(`privacyRequests.channel.${data.channel}`)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("privacyRequests.columns.due")}</dt>
                <dd className="tnum">{formatDate(data.due_on)}</dd>
              </div>
              {data.note ? (
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("privacyRequests.field.note")}</dt>
                  <dd className="break-words">{data.note}</dd>
                </div>
              ) : null}
            </dl>

            <section aria-label={t("privacyRequests.sheet.timeline")}>
              <h3 className="mb-2 font-bold">{t("privacyRequests.sheet.timeline")}</h3>
              {data.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("privacyRequests.sheet.noSteps")}
                </p>
              ) : (
                <ol className="space-y-2">
                  {data.events.map((entry) => (
                    <li key={entry.id} className="rounded-md border p-2 text-sm">
                      <p className="font-semibold">
                        {t(`privacyRequests.event.${entry.event_type}`)}
                        {entry.outcome ? ` · ${t(`privacyRequests.outcome.${entry.outcome}`)}` : ""}
                      </p>
                      <p className="break-words">{entry.detail}</p>
                      <p className="tnum text-[13px] text-muted-foreground">
                        {formatDate(entry.created_at)}, {formatTime(entry.created_at)}
                        {entry.created_by_name ? ` · ${entry.created_by_name}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {nextSteps(data.status).length > 0 ? (
              <StepForm
                key={data.status + data.events.length}
                requestId={data.id}
                steps={nextSteps(data.status)}
                isErasure={data.kind === "erasure"}
              />
            ) : (
              <Alert>
                <span>{t("privacyRequests.sheet.closed")}</span>
              </Alert>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
