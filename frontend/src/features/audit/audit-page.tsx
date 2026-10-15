// Audit log viewer (spec §4.16): who changed what, when and from where. Read-only.
// Clicking a row opens a side panel with the before/after values field by field.
import { Bot, Cpu, UserRound, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { formatDate, formatTime } from "@/lib/format";
import { type AuditEntry, useAudit } from "./use-audit";

const ACTOR_ICONS = { user: UserRound, kiosk: Cpu, system: Bot };

function ValueDifference({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const fields = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ];
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("audit.noFieldChanges")}</p>;
  }
  const show = (value: unknown) =>
    value === undefined || value === null
      ? "–"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  return (
    <dl className="space-y-3">
      {fields.map((field) => (
        <div key={field} className="rounded-md border p-3">
          <dt className="code text-xs font-semibold text-muted-foreground">{field}</dt>
          {entry.before && field in entry.before ? (
            <dd className="mt-1 text-[13px]">
              <span className="font-bold text-destructive">− {t("audit.before")} </span>
              <span className="break-all line-through">{show(entry.before[field])}</span>
            </dd>
          ) : null}
          {entry.after && field in entry.after ? (
            <dd className="mt-1 text-[13px]">
              <span className="font-bold text-success">+ {t("audit.after")} </span>
              <span className="break-all">{show(entry.after[field])}</span>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ from: "", to: "", actor_type: "", action: "" });
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const audit = useAudit({
    from: filters.from ? `${filters.from}T00:00:00+05:30` : undefined,
    to: filters.to ? `${filters.to}T23:59:59+05:30` : undefined,
    actor_type: filters.actor_type || undefined,
    action: filters.action.trim() || undefined,
    page: 1,
  });

  const set = (name: keyof typeof filters) => (value: string) =>
    setFilters((current) => ({ ...current, [name]: value }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("audit.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("audit.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="mb-1 block text-xs font-semibold">
            {t("audit.filters.from")}
          </label>
          <Input
            id="from"
            type="date"
            value={filters.from}
            onChange={(e) => set("from")(e.target.value)}
            className="h-10 w-40"
          />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-xs font-semibold">
            {t("audit.filters.to")}
          </label>
          <Input
            id="to"
            type="date"
            value={filters.to}
            onChange={(e) => set("to")(e.target.value)}
            className="h-10 w-40"
          />
        </div>
        <div>
          <label htmlFor="actor" className="mb-1 block text-xs font-semibold">
            {t("audit.filters.actor")}
          </label>
          <Select
            id="actor"
            value={filters.actor_type}
            onChange={(e) => set("actor_type")(e.target.value)}
            className="h-10 w-40"
          >
            <option value="">{t("audit.filters.anyone")}</option>
            <option value="user">{t("audit.actors.user")}</option>
            <option value="kiosk">{t("audit.actors.kiosk")}</option>
            <option value="system">{t("audit.actors.system")}</option>
          </Select>
        </div>
        <div>
          <label htmlFor="action" className="mb-1 block text-xs font-semibold">
            {t("audit.filters.action")}
          </label>
          <Input
            id="action"
            placeholder="auth.login"
            value={filters.action}
            onChange={(e) => set("action")(e.target.value)}
            className="code h-10 w-48"
          />
        </div>
      </div>

      {audit.isError ? (
        <Alert tone="danger">
          <span>{describeError(audit.error, t)}</span>
        </Alert>
      ) : null}

      <div className="flex items-start gap-4">
        <Card className="min-w-0 flex-1 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("audit.columns.time")}</TableHead>
                <TableHead>{t("audit.columns.actor")}</TableHead>
                <TableHead>{t("audit.columns.action")}</TableHead>
                <TableHead>{t("audit.columns.entity")}</TableHead>
                <TableHead>{t("audit.columns.ip")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.isPending
                ? Array.from({ length: 6 }, (_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                    <TableRow key={index}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : audit.data?.items.map((entry) => {
                    const ActorIcon = ACTOR_ICONS[entry.actor_type];
                    return (
                      <TableRow
                        key={entry.id}
                        className={selected?.id === entry.id ? "bg-primary-soft" : undefined}
                      >
                        <TableCell className="tnum whitespace-nowrap">
                          <button
                            type="button"
                            className="text-left font-medium text-primary hover:underline"
                            onClick={() => setSelected(entry)}
                          >
                            {formatDate(entry.at)}, {formatTime(entry.at)}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge tone="neutral">
                            <ActorIcon aria-hidden />
                            {entry.actor_name ?? t(`audit.actors.${entry.actor_type}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="code">{entry.action}</TableCell>
                        <TableCell>{entry.entity_type}</TableCell>
                        <TableCell className="code text-muted-foreground">
                          {entry.ip ?? "–"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
          {audit.data && audit.data.items.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">{t("audit.empty")}</p>
          ) : null}
        </Card>

        {selected ? (
          <aside
            aria-label={t("audit.details")}
            className="sticky top-24 w-80 shrink-0 rounded-lg border bg-card p-5 shadow-sm"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="code text-sm font-bold">{selected.action}</h2>
                <p className="tnum text-xs text-muted-foreground">
                  {formatDate(selected.at)}, {formatTime(selected.at)} IST
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("common.close")}
                onClick={() => setSelected(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <ValueDifference entry={selected} />
            {selected.reason ? (
              <p className="mt-3 text-[13px]">
                <span className="font-semibold">{t("audit.reason")}: </span>
                {selected.reason}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-subtle-foreground">{t("audit.readOnlyNote")}</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
