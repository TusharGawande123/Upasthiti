// Data requests (/admin/privacy-requests, M6 spec 4.1): the register of what people ask about
// their data (see it, correct it, erase it, withdraw consent, complain) with the 30-day clock.
// Super Admin only. A row opens the sheet with the steps.
import { CircleCheck, CircleDot, Clock, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatDate } from "@/lib/format";
import { AddRequestDialog, RequestSheet } from "./request-dialogs";
import {
  type DataRequest,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  useDataRequests,
  useDueSoonRequests,
} from "./use-data-requests";

// The due date in words: how many days are left, or how many days late.
function DueText({ request }: { request: DataRequest }) {
  const { t } = useTranslation();
  if (request.days_left === null) {
    return <span className="text-muted-foreground">{t("privacyRequests.due.closed")}</span>;
  }
  if (request.days_left < 0) {
    return (
      <Badge tone="danger">
        <TriangleAlert aria-hidden />
        {t("privacyRequests.due.overdue", { count: -request.days_left })}
      </Badge>
    );
  }
  return (
    <Badge tone={request.days_left <= 5 ? "warning" : "neutral"}>
      <Clock aria-hidden />
      {t("privacyRequests.due.left", { count: request.days_left })}
    </Badge>
  );
}

function StatusChip({ request }: { request: DataRequest }) {
  const { t } = useTranslation();
  const Icon = request.status === "closed" ? CircleCheck : CircleDot;
  return (
    <Badge tone={request.status === "closed" ? "success" : "primary"}>
      <Icon aria-hidden />
      {t(`privacyRequests.status.${request.status}`)}
    </Badge>
  );
}

export function PrivacyRequestsPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ status: "", kind: "", overdue: false });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useDataRequests({
    status: filters.status || undefined,
    kind: filters.kind || undefined,
    overdue: filters.overdue || undefined,
    page: 1,
  });
  const dueSoon = useDueSoonRequests();
  const dueSoonCount = dueSoon.data?.total ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("privacyRequests.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("privacyRequests.subtitle")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t("privacyRequests.add.button")}
        </Button>
      </div>

      {dueSoonCount > 0 ? (
        <Alert tone="warning">
          <TriangleAlert aria-hidden />
          <span>{t("privacyRequests.banner", { count: dueSoonCount })}</span>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-status" className="mb-1 block text-xs font-semibold">
            {t("privacyRequests.filter.status")}
          </label>
          <Select
            id="filter-status"
            value={filters.status}
            className="h-10 w-48"
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">{t("privacyRequests.filter.any")}</option>
            {REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`privacyRequests.status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="filter-kind" className="mb-1 block text-xs font-semibold">
            {t("privacyRequests.filter.kind")}
          </label>
          <Select
            id="filter-kind"
            value={filters.kind}
            className="h-10 w-48"
            onChange={(event) => setFilters({ ...filters, kind: event.target.value })}
          >
            <option value="">{t("privacyRequests.filter.any")}</option>
            {REQUEST_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`privacyRequests.kind.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })}
          />
          {t("privacyRequests.filter.overdue")}
        </label>
      </div>

      {list.isError ? (
        <Alert tone="danger">
          <span>{describeError(list.error, t)}</span>
          <Button variant="outline" size="sm" onClick={() => list.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("privacyRequests.columns.received")}</TableHead>
              <TableHead>{t("privacyRequests.columns.person")}</TableHead>
              <TableHead>{t("privacyRequests.columns.kind")}</TableHead>
              <TableHead>{t("privacyRequests.columns.status")}</TableHead>
              <TableHead>{t("privacyRequests.columns.due")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending
              ? Array.from({ length: 4 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : list.data?.items.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="tnum whitespace-nowrap">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setOpenId(request.id)}
                      >
                        {formatDate(request.received_on)}
                      </button>
                    </TableCell>
                    <TableCell>
                      {request.employee_code ? (
                        <>
                          {request.employee_name}{" "}
                          <span className="code">{request.employee_code}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("privacyRequests.notEmployee")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{t(`privacyRequests.kind.${request.kind}`)}</TableCell>
                    <TableCell>
                      <StatusChip request={request} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="tnum mr-2">{formatDate(request.due_on)}</span>
                      <DueText request={request} />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {list.data && list.data.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("privacyRequests.empty")}
          </p>
        ) : null}
      </Card>

      {adding ? <AddRequestDialog onClose={() => setAdding(false)} /> : null}
      {openId ? <RequestSheet requestId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
