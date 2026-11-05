// Full data export (/admin/data-export, M6 spec 4.2): download everything the system holds (never
// face templates, passwords, keys or stored photos) to the Super Admin's own computer. The server
// asks for the password again and for a reason, and writes both into the audit log.
import { Download, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime } from "@/lib/format";
import { useFullExport, useRecentExports } from "./use-data-export";

const REASON_MIN = 3;
const REASON_MAX = 300;
const INCLUDED = ["people", "attendance", "devices", "audit", "settings"] as const;
const NEVER_INCLUDED = ["faces", "passwords", "keys", "photos"] as const;

function formatSize(bytes: number | null): string {
  if (bytes === null) return "–";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataExportPage() {
  const { t } = useTranslation();
  const exportFile = useFullExport();
  const recent = useRecentExports();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");

  const valid = reason.trim().length >= REASON_MIN && password !== "";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("dataExport.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dataExport.subtitle")}</p>
      </div>

      <Card className="space-y-4 p-5">
        <Alert tone="warning">
          <ShieldAlert aria-hidden />
          <span>{t("dataExport.warning")}</span>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="mb-1 font-bold">{t("dataExport.included.title")}</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {INCLUDED.map((item) => (
                <li key={item}>{t(`dataExport.included.${item}`)}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-1 font-bold">{t("dataExport.never.title")}</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {NEVER_INCLUDED.map((item) => (
                <li key={item}>{t(`dataExport.never.${item}`)}</li>
              ))}
            </ul>
          </section>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            exportFile.mutate(
              { reason: reason.trim(), password },
              {
                onSuccess: () => {
                  toast.success(t("dataExport.toast.done"));
                  setPassword("");
                },
                // A wrong password must be typed again; the reason stays.
                onError: () => setPassword(""),
              },
            );
          }}
        >
          {exportFile.error ? (
            <Alert tone="danger">
              <span>{describeError(exportFile.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="export-reason" label={t("dataExport.field.reason")}>
            <Textarea
              id="export-reason"
              value={reason}
              maxLength={REASON_MAX}
              rows={2}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field
            id="export-password"
            label={t("dataExport.field.password")}
            hint={t("dataExport.field.passwordHint")}
          >
            <Input
              id="export-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!valid || exportFile.isPending}>
            {exportFile.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {exportFile.isPending ? t("dataExport.preparing") : t("dataExport.button")}
          </Button>
          {exportFile.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("dataExport.preparingHint")}
            </p>
          ) : null}
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-bold">{t("dataExport.recent.title")}</h2>
        {recent.isError ? (
          <Alert tone="danger">
            <span>{describeError(recent.error, t)}</span>
          </Alert>
        ) : null}
        {recent.data && recent.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dataExport.recent.empty")}</p>
        ) : null}
        <ul className="divide-y">
          {recent.data?.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="tnum">
                {formatDate(entry.at)}, {formatTime(entry.at)}
              </span>
              <span>{entry.actor_name ?? "–"}</span>
              <span className="tnum text-muted-foreground">{formatSize(entry.size_bytes)}</span>
              <Badge tone={entry.status === "done" ? "success" : "danger"}>
                {t(`dataExport.recent.${entry.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
