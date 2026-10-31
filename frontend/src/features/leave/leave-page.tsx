// Leave (/admin/leave, spec M5 §4.8, design gate C screen 1): the days a person is away, paid or
// unpaid. Everyone in scope reads it; only the Super Admin adds and cancels (people do not apply
// for leave). The reason is shown to the Super Admin only (decision 0036 line 7); the server
// sends it empty to everyone else.
import { Ban, CircleCheck, CircleSlash, IndianRupee, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlantFilterSelect, usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/features/attendance/attendance-format";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { cn } from "@/lib/utils";
import { AddLeaveDialog, CancelLeaveDialog } from "./leave-dialogs";
import { type Leave, type LeaveFilters, useLeave } from "./use-leave";

type PayChoice = "all" | "paid" | "unpaid";
type StateChoice = "all" | "active" | "cancelled";

// A row of buttons where exactly one is chosen (a filter), with the word on each button.
function Segments<Choice extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: Choice;
  choices: { value: Choice; text: string; icon?: typeof Ban }[];
  onChange: (next: Choice) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="float-left mr-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {label}
      </legend>
      {choices.map(({ value: choice, text, icon: Icon }) => (
        <button
          key={choice}
          type="button"
          aria-pressed={value === choice}
          onClick={() => onChange(choice)}
          className={cn(
            "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold",
            value === choice
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong bg-card",
          )}
        >
          {Icon ? <Icon className="size-4" aria-hidden /> : null}
          {text}
        </button>
      ))}
    </fieldset>
  );
}

function PayBadge({ paid }: { paid: boolean }) {
  const { t } = useTranslation();
  return paid ? (
    <Badge tone="success">
      <IndianRupee aria-hidden />
      {t("leave.pay.paid")}
    </Badge>
  ) : (
    <Badge className="border border-dashed border-warning bg-card text-warning">
      <CircleSlash aria-hidden />
      {t("leave.pay.unpaid")}
    </Badge>
  );
}

function daysBetween(from: string, to: string): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day) + 1;
}

function LeaveRow({
  leave,
  showReason,
  canCancel,
  onCancel,
}: {
  leave: Leave;
  showReason: boolean;
  canCancel: boolean;
  onCancel: (leave: Leave) => void;
}) {
  const { t } = useTranslation();
  const cancelled = leave.cancelled !== null;
  const notCounted = daysBetween(leave.from_date, leave.to_date) - leave.working_days;
  const struck = cancelled ? "line-through text-muted-foreground" : "";
  return (
    <TableRow>
      <TableCell>
        <span className={cn("block font-semibold", struck)}>{leave.employee.name}</span>
        <span className="code text-xs text-muted-foreground">{leave.employee.code}</span>
      </TableCell>
      <TableCell className={cn("tnum", struck)}>{formatDay(leave.from_date)}</TableCell>
      <TableCell className={cn("tnum", struck)}>{formatDay(leave.to_date)}</TableCell>
      <TableCell className="text-right">
        <span className="tnum font-bold">{leave.working_days}</span>
        {notCounted > 0 ? (
          <span className="block text-xs text-muted-foreground">
            {t("leave.notCounted", { count: notCounted })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <PayBadge paid={leave.is_paid} />
      </TableCell>
      {showReason ? (
        <TableCell className="max-w-64 text-sm">
          <span className="block">{leave.reason}</span>
          {leave.cancelled?.reason ? (
            <span className="block text-xs text-muted-foreground">
              {t("leave.cancelledWithReason", { reason: leave.cancelled.reason })}
            </span>
          ) : null}
        </TableCell>
      ) : null}
      <TableCell className="text-sm">{leave.created_by.name}</TableCell>
      <TableCell>
        {cancelled ? (
          <div className="space-y-1">
            <Badge className="border border-dashed border-border-strong">
              <Ban aria-hidden />
              {t("leave.state.cancelled")}
            </Badge>
            {!showReason && leave.cancelled ? (
              <span className="block text-xs text-muted-foreground">
                {t("leave.cancelledBy", { name: leave.cancelled.by.name })}
              </span>
            ) : null}
          </div>
        ) : (
          <Badge tone="primary">
            <CircleCheck aria-hidden />
            {t("leave.state.active")}
          </Badge>
        )}
      </TableCell>
      {canCancel ? (
        <TableCell>
          {cancelled ? null : (
            <Button size="sm" variant="outline" onClick={() => onCancel(leave)}>
              {t("leave.cancel")}
            </Button>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

export function LeavePage() {
  const { t } = useTranslation();
  const me = useMe();
  const isSuperAdmin = me.data?.role === "super_admin";
  const { plantId, setPlantId, locked } = usePlantFilter();
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [pay, setPay] = useState<PayChoice>("all");
  const [state, setState] = useState<StateChoice>("all");
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Leave | null>(null);

  const filters: LeaveFilters = {
    plant_id: plantId || undefined,
    month: month || undefined,
    is_paid: pay === "all" ? undefined : pay === "paid",
    state: state === "all" ? undefined : state,
  };
  const leave = useLeave(filters);

  // The API has no name search, so the box narrows the rows that were loaded.
  const needle = search.trim().toLowerCase();
  const rows = (leave.data?.items ?? []).filter(
    (item) =>
      !needle ||
      item.employee.name.toLowerCase().includes(needle) ||
      item.employee.code.toLowerCase().includes(needle),
  );
  const filtered =
    needle !== "" ||
    month !== "" ||
    pay !== "all" ||
    state !== "all" ||
    (plantId !== "" && !locked);
  const clearFilters = () => {
    setSearch("");
    setMonth("");
    setPay("all");
    setState("all");
    if (!locked) setPlantId("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("leave.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t(isSuperAdmin ? "leave.subtitle.admin" : "leave.subtitle.readOnly")}
          </p>
        </div>
        {isSuperAdmin ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("leave.add")}
          </Button>
        ) : null}
      </div>

      {me.data && !isSuperAdmin ? <Alert tone="info">{t("leave.readOnly")}</Alert> : null}

      <Card className="overflow-hidden">
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label={t("leave.filter.search")}
                placeholder={t("leave.filter.search")}
                value={search}
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <PlantFilterSelect />
            <Input
              type="month"
              aria-label={t("leave.filter.month")}
              value={month}
              className="tnum sm:w-44"
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Segments<PayChoice>
              label={t("leave.filter.pay")}
              value={pay}
              onChange={setPay}
              choices={[
                { value: "all", text: t("leave.pay.all") },
                { value: "paid", text: t("leave.pay.paid"), icon: IndianRupee },
                { value: "unpaid", text: t("leave.pay.unpaid"), icon: CircleSlash },
              ]}
            />
            <Segments<StateChoice>
              label={t("leave.filter.state")}
              value={state}
              onChange={setState}
              choices={[
                { value: "active", text: t("leave.state.active"), icon: CircleCheck },
                { value: "cancelled", text: t("leave.state.cancelled"), icon: Ban },
                { value: "all", text: t("leave.state.all") },
              ]}
            />
          </div>
        </div>

        {leave.isError ? (
          <div className="space-y-3 p-4">
            <Alert tone="danger">
              <span>
                <strong>{t("leave.loadError")}.</strong> {describeError(leave.error, t)}
              </span>
            </Alert>
            <Button variant="outline" onClick={() => leave.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : null}

        {leave.isPending ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : null}

        {leave.data && rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-lg font-bold">
              {t(filtered ? "leave.filterEmpty.title" : "leave.empty.title")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t(filtered ? "leave.filterEmpty.body" : "leave.empty.body")}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {filtered ? (
                <Button variant="outline" onClick={clearFilters}>
                  {t("leave.filter.clear")}
                </Button>
              ) : isSuperAdmin ? (
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden />
                  {t("leave.add")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {leave.data && rows.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("leave.col.employee")}</TableHead>
                  <TableHead>{t("leave.col.from")}</TableHead>
                  <TableHead>{t("leave.col.to")}</TableHead>
                  <TableHead className="text-right">{t("leave.col.workingDays")}</TableHead>
                  <TableHead>{t("leave.col.pay")}</TableHead>
                  {isSuperAdmin ? <TableHead>{t("leave.col.reason")}</TableHead> : null}
                  <TableHead>{t("leave.col.enteredBy")}</TableHead>
                  <TableHead>{t("leave.col.state")}</TableHead>
                  {isSuperAdmin ? (
                    <TableHead>
                      <span className="sr-only">{t("common.actions")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <LeaveRow
                    key={item.id}
                    leave={item}
                    showReason={isSuperAdmin}
                    canCancel={isSuperAdmin}
                    onCancel={setCancelling}
                  />
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>{t("leave.count", { count: rows.length })}</span>
              <span>{t("leave.workingDaysNote")}</span>
            </div>
          </>
        ) : null}
      </Card>

      {adding ? <AddLeaveDialog onClose={() => setAdding(false)} /> : null}
      {cancelling ? (
        <CancelLeaveDialog leave={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  );
}
