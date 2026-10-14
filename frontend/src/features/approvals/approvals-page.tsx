// Approvals inbox (Super Admin) and "My requests" (Corporate Head): the same list. The server
// shows each role only what it may see. A Corporate Head's employee changes wait here until the
// Super Admin approves or rejects (with a reason). Nothing is applied before approval.
import {
  ArrowRightLeft,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  FileSpreadsheet,
  Hourglass,
  Inbox,
  Layers,
  Pencil,
  Undo2,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
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
import { ApiError } from "@/lib/api-client";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type ChangeRequest,
  type RequestKind,
  type RequestStatus,
  useChangeRequests,
  useDecideRequest,
} from "./use-approvals";

const KIND_ICONS: Record<RequestKind, typeof Pencil> = {
  "employee.create": UserPlus,
  "employee.update": Pencil,
  "employee.transfer": ArrowRightLeft,
  "employee.bulk": Layers,
  "employee.import": FileSpreadsheet,
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  const map = {
    pending: { tone: "warning", icon: Hourglass },
    approved: { tone: "success", icon: CircleCheck },
    rejected: { tone: "danger", icon: CircleX },
    withdrawn: { tone: "neutral", icon: Undo2 },
    failed: { tone: "danger", icon: CircleAlert },
  } as const;
  const { tone, icon: Icon } = map[status];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {t(`approvals.status.${status}`)}
    </Badge>
  );
}

/** The readable facts of a request: simple values only (ids of chosen items are skipped). */
function payloadFacts(request: ChangeRequest): [string, string][] {
  const payload = request.payload;
  const facts: [string, string][] = [];
  const addAll = (source: unknown) => {
    if (typeof source !== "object" || source === null) return;
    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined || key.endsWith("_id") || key === "employee_ids")
        continue;
      facts.push([key, String(value)]);
    }
  };
  addAll(payload.values);
  addAll(payload.changes);
  addAll(payload.transfer);
  addAll(payload.params);
  if (request.kind === "employee.bulk") {
    facts.unshift(["action", String(payload.action ?? "")]);
    const ids = payload.employee_ids;
    if (Array.isArray(ids)) facts.unshift(["people", String(ids.length)]);
  }
  if (request.kind === "employee.import") {
    const rows = payload.rows;
    facts.push(["rows", Array.isArray(rows) ? String(rows.length) : "0"]);
    if (payload.file_name) facts.push(["file", String(payload.file_name)]);
  }
  return facts;
}

function RequestDrawer({
  request,
  canDecide,
  canWithdraw,
  onClose,
}: {
  request: ChangeRequest;
  canDecide: boolean;
  canWithdraw: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const decide = useDecideRequest();
  const [rejecting, setRejecting] = useState(false);
  const pending = request.status === "pending";
  const reason = typeof request.payload.reason === "string" ? request.payload.reason : null;
  // When approving fails the server names the reason (for example EMPLOYEE_CODE_EXISTS).
  const failedReason =
    decide.error instanceof ApiError && typeof decide.error.details.reason === "string"
      ? decide.error.details.reason
      : null;
  const failedErrors =
    (request.result?.errors as { code: string; message: string }[] | undefined) ?? [];

  const finish = (message: string) => {
    toast.success(message);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="top-0 right-0 left-auto h-screen max-w-md translate-x-0 translate-y-0 overflow-y-auto rounded-none">
        <DialogTitle>{request.summary}</DialogTitle>
        <DialogDescription>{t(`approvals.kind.${request.kind}`)}</DialogDescription>
        <div className="mt-4 space-y-4">
          <RequestStatusBadge status={request.status} />
          {pending && canDecide ? (
            <Alert tone="info">
              <span>
                <b>{t("approvals.drawer.nothingChanged")}</b> {t("approvals.drawer.approveApplies")}
              </span>
            </Alert>
          ) : null}
          {decide.error ? (
            <Alert tone="danger">
              <span>
                {describeError(decide.error, t)}
                {failedReason
                  ? ` (${t(`errors.${failedReason}`, { defaultValue: failedReason })})`
                  : ""}
              </span>
            </Alert>
          ) : null}
          {request.status === "failed" ? (
            <Alert tone="danger">
              <span>
                <b>{t("approvals.drawer.failedTitle")}</b>{" "}
                {failedErrors.map((error) => error.message).join(" ") ||
                  t("approvals.drawer.failedText")}
              </span>
            </Alert>
          ) : null}

          <dl className="space-y-2 text-sm">
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <dt className="text-muted-foreground">{t("approvals.columns.requestedBy")}</dt>
              <dd className="font-medium">{request.requested_by_name ?? "–"}</dd>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <dt className="text-muted-foreground">{t("approvals.columns.sent")}</dt>
              <dd className="tnum font-medium">
                {formatDate(request.requested_at)} {formatTime(request.requested_at)} IST
              </dd>
            </div>
            {request.decided_at ? (
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="text-muted-foreground">{t("approvals.drawer.decided")}</dt>
                <dd className="tnum font-medium">
                  {formatDate(request.decided_at)} {formatTime(request.decided_at)} IST
                </dd>
              </div>
            ) : null}
            {request.decision_reason ? (
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="text-muted-foreground">{t("approvals.drawer.decisionReason")}</dt>
                <dd className="font-medium">{request.decision_reason}</dd>
              </div>
            ) : null}
          </dl>

          {reason ? (
            <div>
              <h3 className="mb-1 text-sm font-bold">{t("approvals.drawer.why")}</h3>
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{reason}</p>
            </div>
          ) : null}

          <div>
            <h3 className="mb-1 text-sm font-bold">{t("approvals.drawer.what")}</h3>
            <ul className="divide-y rounded-md border text-sm">
              {payloadFacts(request).map(([key, value]) => (
                <li key={key} className="flex justify-between gap-3 px-3 py-2">
                  <span className="text-muted-foreground">
                    {t(`approvals.fields.${key}`, { defaultValue: key })}
                  </span>
                  <span className="text-right font-medium">{value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            {pending && canDecide ? (
              <>
                <Button variant="danger" onClick={() => setRejecting(true)}>
                  <CircleX aria-hidden />
                  {t("approvals.reject")}
                </Button>
                <Button
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate(
                      { id: request.id, action: "approve" },
                      { onSuccess: () => finish(t("approvals.approved")) },
                    )
                  }
                >
                  <CircleCheck aria-hidden />
                  {t("approvals.approve")}
                </Button>
              </>
            ) : null}
            {pending && canWithdraw ? (
              <Button
                variant="outline"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate(
                    { id: request.id, action: "withdraw" },
                    { onSuccess: () => finish(t("approvals.withdrawn")) },
                  )
                }
              >
                <Ban aria-hidden />
                {t("approvals.withdraw")}
              </Button>
            ) : null}
          </div>
        </div>

        <ReasonDialog
          open={rejecting}
          onOpenChange={setRejecting}
          title={t("approvals.rejectTitle")}
          confirmLabel={t("approvals.reject")}
          isPending={decide.isPending}
          error={decide.error ? describeError(decide.error, t) : undefined}
          onConfirm={(text) =>
            decide.mutate(
              { id: request.id, action: "reject", reason: text },
              { onSuccess: () => finish(t("approvals.rejected")) },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}

type Props = {
  /** true = "My requests" for a Corporate Head; false = the Super Admin's inbox. */
  mine: boolean;
};

export function ApprovalsPage({ mine }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"waiting" | "history">("waiting");
  const [kind, setKind] = useState<RequestKind | "">("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  // The API filters by one status; "history" is everything that is not pending, so it is
  // fetched without a status filter and the waiting ones are left out here.
  const requests = useChangeRequests({
    status: tab === "waiting" ? "pending" : undefined,
    kind: kind || undefined,
    page,
  });
  const rows = (requests.data?.items ?? []).filter(
    (item) => tab === "waiting" || item.status !== "pending",
  );
  const open = requests.data?.items.find((item) => item.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">
          {mine ? t("approvals.myTitle") : t("approvals.title")}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          {mine ? t("approvals.mySubtitle") : t("approvals.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex rounded-lg border bg-card p-1">
          {(["waiting", "history"] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
                setPage(1);
              }}
              className={cn(
                "cursor-pointer rounded-md px-4 py-1.5 text-sm font-semibold",
                tab === name
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`approvals.tab.${name}`)}
            </button>
          ))}
        </div>
        <Select
          aria-label={t("approvals.columns.kind")}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as RequestKind | "");
            setPage(1);
          }}
          className="w-auto"
        >
          <option value="">{t("approvals.anyKind")}</option>
          {(Object.keys(KIND_ICONS) as RequestKind[]).map((name) => (
            <option key={name} value={name}>
              {t(`approvals.kind.${name}`)}
            </option>
          ))}
        </Select>
      </div>

      {requests.isError ? (
        <Alert tone="danger">
          <span>{describeError(requests.error, t)}</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => requests.refetch()}
          >
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}
      {requests.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {requests.data && rows.length === 0 ? (
        <Card className="p-10 text-center">
          <Inbox className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-bold">
            {tab === "waiting" ? t("approvals.empty.waiting") : t("approvals.empty.history")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {mine ? t("approvals.empty.mineText") : t("approvals.empty.text")}
          </p>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("approvals.columns.kind")}</TableHead>
                <TableHead>{t("approvals.columns.what")}</TableHead>
                {!mine ? <TableHead>{t("approvals.columns.requestedBy")}</TableHead> : null}
                <TableHead>{t("approvals.columns.sent")}</TableHead>
                <TableHead>{t("approvals.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((request) => {
                const Icon = KIND_ICONS[request.kind];
                return (
                  <TableRow
                    key={request.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(request.id)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon className="size-4 text-primary" aria-hidden />
                        {t(`approvals.kind.${request.kind}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="cursor-pointer text-left hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenId(request.id);
                        }}
                      >
                        {request.summary}
                      </button>
                    </TableCell>
                    {!mine ? <TableCell>{request.requested_by_name ?? "–"}</TableCell> : null}
                    <TableCell className="tnum text-muted-foreground">
                      {formatDate(request.requested_at)} {formatTime(request.requested_at)}
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={request.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {open ? (
        <RequestDrawer
          request={open}
          canDecide={!mine}
          canWithdraw={mine}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
