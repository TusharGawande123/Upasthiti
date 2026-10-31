// Corrections (/admin/corrections, spec M5 §4.7, design gate B screen 5): the requests to change an
// attendance day. Tabs Pending, Decided, Punch approvals and (heads only) My requests. The Super
// Admin approves, rejects (with a reason) and reverses; a requester withdraws a pending request.
// Making a new correction and the bulk wizard are built in M5 slice 7 group C, not here.
import {
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Lock,
  Pencil,
  Undo,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { addDays } from "@/lib/dates";
import { formatDate, formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDay } from "./attendance-format";
import {
  type Correction,
  type CorrectionAction,
  type CorrectionState,
  useCorrectionAction,
  useCorrections,
  usePunchApprovals,
} from "./use-attendance-admin";

const PAGE_SIZE = 25;
const REASON_MIN = 3;
const REASON_MAX = 300;
const DECIDED_STATES: CorrectionState[] = ["approved", "rejected", "withdrawn", "reversed"];

const STATE_LOOK: Record<CorrectionState, { icon: typeof Clock; colours: string }> = {
  pending: { icon: Clock, colours: "bg-[#eaeefb] text-[#1a3282]" },
  approved: { icon: CircleCheck, colours: "bg-[#e6f5ee] text-[#04694b]" },
  rejected: { icon: CircleX, colours: "bg-[#fdecea] text-[#b42318]" },
  withdrawn: { icon: Ban, colours: "bg-[#eef1f5] text-[#4a5567]" },
  reversed: { icon: Undo2, colours: "bg-[#fff3d6] text-[#8f5300]" },
};

function StateBadge({ state }: { state: CorrectionState }) {
  const { t } = useTranslation();
  const { icon: Icon, colours } = STATE_LOOK[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
        colours,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`corrections.state.${state}`)}
    </span>
  );
}

/** What the request asks for, in words: "IN 09:10", "IN 09:00 · OUT 17:00" or "Present". */
function requestedText(correction: Correction, t: (key: string) => string): string {
  const parts: string[] = [];
  if (correction.in_time) parts.push(`${t("corrections.in")} ${formatTime(correction.in_time)}`);
  if (correction.out_time) parts.push(`${t("corrections.out")} ${formatTime(correction.out_time)}`);
  if (correction.status_value) parts.push(t(`corrections.status.${correction.status_value}`));
  return parts.join(" · ");
}

type ReasonBoxProps = {
  label: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

// The box for "Reject" and "Reverse": a reason of 3 to 300 characters is needed.
function ReasonBox({ label, confirmLabel, pending, onConfirm, onCancel }: ReasonBoxProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;
  return (
    <div className="space-y-2 rounded-md border bg-muted/50 p-3">
      <label htmlFor="reason-box" className="block text-sm font-semibold">
        {label}
      </label>
      <Textarea
        id="reason-box"
        value={reason}
        maxLength={REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t("corrections.reasonRange")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={!valid || pending}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("corrections.cancel")}
        </Button>
      </div>
    </div>
  );
}

function CorrectionCard({
  correction,
  isSuperAdmin,
  myId,
}: {
  correction: Correction;
  isSuperAdmin: boolean;
  myId: string | undefined;
}) {
  const { t } = useTranslation();
  const act = useCorrectionAction();
  const [asking, setAsking] = useState<"reject" | "reverse" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = (action: CorrectionAction, reason?: string) => {
    setError(null);
    act.mutate(
      { id: correction.id, action, reason },
      {
        onSuccess: () => {
          setAsking(null);
          toast.success(t(`corrections.done.${action}`));
        },
        onError: (failure) => setError(failure),
      },
    );
  };

  const pending = correction.state === "pending";
  const canWithdraw = pending && correction.requested_by.id === myId;
  const canReverse = isSuperAdmin && correction.state === "approved" && !correction.reverses_id;
  const requested = requestedText(correction, t);

  return (
    <li>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">
              {correction.employee.name}{" "}
              <span className="font-mono text-sm font-semibold text-muted-foreground">
                {correction.employee.code}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{formatDay(correction.attendance_date)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
              <Pencil className="size-3.5" aria-hidden />
              {t(`corrections.kind.${correction.kind}`)}
            </span>
            <StateBadge state={correction.state} />
          </div>
        </div>
        {requested ? <p className="tnum font-semibold">{requested}</p> : null}
        <p className="text-sm">{correction.reason}</p>
        <p className="text-xs text-muted-foreground">
          {t("corrections.askedBy", { name: correction.requested_by.name })} ·{" "}
          {formatDate(correction.requested_at)} {formatTime(correction.requested_at)}
        </p>
        {correction.decision ? (
          <p className="text-xs text-muted-foreground">
            {t("corrections.decidedBy", {
              name: correction.decision.decided_by.name,
              date: formatDate(correction.decision.decided_at),
            })}
            {correction.decision.reason ? `: ${correction.decision.reason}` : ""}
          </p>
        ) : null}
        {pending && !isSuperAdmin ? (
          <p className="text-sm font-semibold text-muted-foreground">{t("corrections.waiting")}</p>
        ) : null}

        {error ? (
          <Alert tone="danger">
            <span>{describeError(error, t)}</span>
          </Alert>
        ) : null}

        {asking === "reject" ? (
          <ReasonBox
            label={t("corrections.rejectReason")}
            confirmLabel={t("corrections.rejectConfirm")}
            pending={act.isPending}
            onConfirm={(reason) => run("reject", reason)}
            onCancel={() => setAsking(null)}
          />
        ) : null}
        {asking === "reverse" ? (
          <ReasonBox
            label={t("corrections.reverseReason")}
            confirmLabel={t("corrections.reverseConfirm")}
            pending={act.isPending}
            onConfirm={(reason) => run("reverse", reason)}
            onCancel={() => setAsking(null)}
          />
        ) : null}

        {asking === null ? (
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin && pending ? (
              <>
                <Button disabled={act.isPending} onClick={() => run("approve")}>
                  <Check aria-hidden />
                  {t("corrections.approve")}
                </Button>
                <Button variant="danger" onClick={() => setAsking("reject")}>
                  <X aria-hidden />
                  {t("corrections.reject")}
                </Button>
              </>
            ) : null}
            {canWithdraw ? (
              <Button variant="outline" disabled={act.isPending} onClick={() => run("withdraw")}>
                <Undo aria-hidden />
                {t("corrections.withdraw")}
              </Button>
            ) : null}
            {canReverse ? (
              <Button variant="outline" onClick={() => setAsking("reverse")}>
                <Undo2 aria-hidden />
                {t("corrections.reverse")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (lastPage === 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t("attendance.previous")}
      </Button>
      <span className="tnum">{t("attendance.pageOf", { page, pages: lastPage })}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
      >
        {t("attendance.next")}
      </Button>
    </div>
  );
}

function ListState({
  isPending,
  error,
  isEmpty,
  retry,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  retry: () => void;
}) {
  const { t } = useTranslation();
  if (isPending)
    return (
      <div className="space-y-2" aria-busy="true">
        {["a", "b", "c"].map((id) => (
          <Skeleton key={id} className="h-28" />
        ))}
      </div>
    );
  if (error)
    return (
      <Alert tone="danger">
        <span className="flex-1">{describeError(error, t)}</span>
        <Button variant="outline" size="sm" onClick={retry}>
          {t("attendance.error.tryAgain")}
        </Button>
      </Alert>
    );
  if (isEmpty)
    return (
      <Card className="p-6">
        <p className="text-lg font-bold">{t("corrections.empty.title")}</p>
        <p className="text-muted-foreground">{t("corrections.empty.text")}</p>
      </Card>
    );
  return null;
}

// One list of correction requests: Pending, Decided (one state at a time) or My requests.
function RequestList({
  state,
  mine,
  isSuperAdmin,
  myId,
}: {
  state?: CorrectionState;
  mine?: boolean;
  isSuperAdmin: boolean;
  myId: string | undefined;
}) {
  const { plantId } = usePlantFilter();
  const [page, setPage] = useState(1);
  const list = useCorrections({
    state,
    mine: mine || undefined,
    plant_id: plantId || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3">
      <ListState
        isPending={list.isPending}
        error={list.isError && !list.data ? list.error : null}
        isEmpty={list.data !== undefined && items.length === 0}
        retry={() => list.refetch()}
      />
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((correction) => (
            <CorrectionCard
              key={correction.id}
              correction={correction}
              isSuperAdmin={isSuperAdmin}
              myId={myId}
            />
          ))}
        </ul>
      ) : null}
      <Pager page={page} total={list.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

function DecidedList({ isSuperAdmin, myId }: { isSuperAdmin: boolean; myId: string | undefined }) {
  const { t } = useTranslation();
  const [state, setState] = useState<CorrectionState>("approved");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DECIDED_STATES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={state === value}
            onClick={() => setState(value)}
            className={cn(
              "h-10 cursor-pointer rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted",
              state === value && "border-primary bg-primary-soft ring-2 ring-primary/30",
            )}
          >
            {t(`corrections.state.${value}`)}
          </button>
        ))}
      </div>
      <RequestList key={state} state={state} isSuperAdmin={isSuperAdmin} myId={myId} />
    </div>
  );
}

// M4 punch reviews, read-only. The heads see what was decided but not the reason.
function PunchApprovals({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useTranslation();
  const { plantId } = usePlantFilter();
  const [page, setPage] = useState(1);
  const today = todayIst();
  const list = usePunchApprovals(
    { from: addDays(today, -31), to: today, plantId: plantId || undefined, page },
    true,
  );
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{t("corrections.approvals.title")}</h2>
        {isSuperAdmin ? (
          <Link to="/admin/review" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("corrections.approvals.open")}
          </Link>
        ) : null}
      </div>
      <ListState
        isPending={list.isPending}
        error={list.isError && !list.data ? list.error : null}
        isEmpty={list.data !== undefined && items.length === 0}
        retry={() => list.refetch()}
      />
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.punch_id}-${item.reviewed_at}`}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {item.employee ? `${item.employee.name} ` : ""}
                    {item.employee ? (
                      <span className="font-mono text-sm font-semibold text-muted-foreground">
                        {item.employee.code}
                      </span>
                    ) : null}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
                      item.action === "approved"
                        ? "bg-[#e6f5ee] text-[#04694b]"
                        : "bg-[#fdecea] text-[#b42318]",
                    )}
                  >
                    {item.action === "approved" ? (
                      <CircleCheck className="size-3.5" aria-hidden />
                    ) : (
                      <CircleX className="size-3.5" aria-hidden />
                    )}
                    {item.action === "approved"
                      ? t("corrections.approvals.approved")
                      : t("corrections.approvals.notAccepted")}
                    {item.direction ? ` · ${item.direction.toUpperCase()}` : ""}
                  </span>
                </div>
                <p className="tnum text-sm">
                  {formatDate(item.punch_time)} {formatTime(item.punch_time)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.reviewed_by.name} · {formatDate(item.reviewed_at)}{" "}
                  {formatTime(item.reviewed_at)}
                </p>
                {item.reason ? (
                  <p className="text-sm">{item.reason}</p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden />
                    {t("corrections.approvals.hidden")}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      <Pager page={page} total={list.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

export function CorrectionsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const role = me.data?.role;
  const isSuperAdmin = role === "super_admin";
  const isHead = role === "corporate_head" || role === "plant_head";
  const myId = me.data?.id;
  const { plantId } = usePlantFilter();
  // Only the number for the tab: the same first page the Pending tab shows.
  const pendingCount = useCorrections({
    state: "pending",
    plant_id: plantId || undefined,
    page: 1,
    page_size: PAGE_SIZE,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("corrections.title")}</h1>
        <p className="text-muted-foreground">
          {isSuperAdmin ? t("corrections.subtitleSuper") : t("corrections.subtitleHead")}
        </p>
      </header>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            {t("corrections.tab.pending")}
            {pendingCount.data ? (
              <span className="tnum rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">
                {pendingCount.data.total}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="decided">{t("corrections.tab.decided")}</TabsTrigger>
          <TabsTrigger value="approvals">{t("corrections.tab.approvals")}</TabsTrigger>
          {isHead ? <TabsTrigger value="mine">{t("corrections.tab.mine")}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="pending">
          <RequestList state="pending" isSuperAdmin={isSuperAdmin} myId={myId} />
        </TabsContent>
        <TabsContent value="decided">
          <DecidedList isSuperAdmin={isSuperAdmin} myId={myId} />
        </TabsContent>
        <TabsContent value="approvals">
          <PunchApprovals isSuperAdmin={isSuperAdmin} />
        </TabsContent>
        {isHead ? (
          <TabsContent value="mine">
            <RequestList mine isSuperAdmin={isSuperAdmin} myId={myId} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
