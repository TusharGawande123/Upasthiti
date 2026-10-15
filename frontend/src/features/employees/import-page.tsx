// Excel import in three steps: 1) download the template and choose the file, 2) the check
// (a dry run: nothing is saved yet) and 3) the result. All or nothing: the file is saved only
// when it has zero errors. For a Corporate Head the same file is sent for approval.
import { Check, CircleX, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  IMPORT_TEMPLATE_URL,
  type ImportResult,
  isPendingApproval,
  useImportEmployees,
} from "./use-employees";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 200;

type Outcome = { kind: "created"; count: number } | { kind: "sent"; count: number };

export function ImportPage() {
  const { t } = useTranslation();
  const me = useMe();
  const forApproval = me.data?.role === "corporate_head";
  const importer = useImportEmployees();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const step = outcome ? 3 : report ? 2 : 1;

  const reset = () => {
    importer.reset();
    setFile(null);
    setReport(null);
    setOutcome(null);
    setFileProblem(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = (chosen: File) => {
    setFileProblem(null);
    importer.reset();
    if (!chosen.name.toLowerCase().endsWith(".xlsx")) {
      setFileProblem(t("import.errors.notExcel"));
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFileProblem(t("import.errors.tooLarge"));
      return;
    }
    setFile(chosen);
    // A dry run: the server checks every row and saves nothing.
    importer.mutate(
      { file: chosen, save: false },
      { onSuccess: (result) => setReport(result as ImportResult) },
    );
  };

  const save = () => {
    if (!file) return;
    importer.mutate(
      { file, save: true },
      {
        onSuccess: (result) =>
          isPendingApproval(result)
            ? setOutcome({ kind: "sent", count: report?.ok_rows ?? 0 })
            : setOutcome({ kind: "created", count: result.created ?? report?.ok_rows ?? 0 }),
      },
    );
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) check(dropped);
  };

  const hasErrors = (report?.error_rows ?? 0) > 0;
  // The server's own error (not the "rows have errors" report) for steps 1 and 2.
  const serverError =
    importer.error instanceof ApiError && importer.error.code === "IMPORT_HAS_ERRORS"
      ? null
      : importer.error;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("import.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {forApproval ? t("import.subtitleApproval") : t("import.subtitle")}
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm font-semibold" aria-label={t("import.steps")}>
        {[1, 2, 3].map((number) => (
          <li
            key={number}
            aria-current={step === number ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1",
              step === number
                ? "border-primary bg-primary-soft text-primary"
                : "text-muted-foreground",
            )}
          >
            <span className="grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">
              {step > number ? <Check className="size-3" aria-hidden /> : number}
            </span>
            {t(`import.step.${number}`)}
          </li>
        ))}
      </ol>

      {serverError ? (
        <Alert tone="danger">
          <span>{describeError(serverError, t)}</span>
        </Alert>
      ) : null}
      {fileProblem ? <Alert tone="danger">{fileProblem}</Alert> : null}

      {step === 1 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("import.template.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{t("import.template.text")}</p>
              <a
                href={IMPORT_TEMPLATE_URL}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-card px-4 font-semibold shadow-xs hover:bg-muted"
              >
                <Download className="size-4" aria-hidden />
                {t("import.template.download")}
              </a>
              <p className="text-[13px] text-muted-foreground">{t("import.template.required")}</p>
            </CardContent>
          </Card>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            disabled={importer.isPending}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-card p-10 text-center hover:bg-muted",
              dragging && "border-primary bg-primary-soft",
            )}
          >
            {importer.isPending ? (
              <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
            ) : (
              <UploadCloud className="size-10 text-primary" aria-hidden />
            )}
            <span className="text-lg font-bold">
              {importer.isPending ? t("import.drop.checking") : t("import.drop.title")}
            </span>
            <span className="text-sm text-muted-foreground">{t("import.drop.text")}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            aria-label={t("import.drop.chooseFile")}
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) check(chosen);
            }}
          />
        </>
      ) : null}

      {step === 2 && report ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5" aria-hidden />
              {file?.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-success-soft p-4 text-success">
                <span className="tnum block text-2xl font-bold">
                  {formatNumber(report.ok_rows)}
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <Check className="size-4" aria-hidden />
                  {t("import.report.ok")}
                </span>
              </div>
              <div
                className={cn(
                  "rounded-lg border p-4",
                  hasErrors
                    ? "bg-destructive-soft text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <span className="tnum block text-2xl font-bold">
                  {formatNumber(report.error_rows)}
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <CircleX className="size-4" aria-hidden />
                  {t("import.report.errors")}
                </span>
              </div>
            </div>

            {hasErrors ? (
              <>
                <Alert tone="warning">
                  <span>
                    <b>{t("import.report.allOrNothingTitle")}</b>{" "}
                    {t("import.report.allOrNothingText")}
                  </span>
                </Alert>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-16">{t("import.report.row")}</TableHead>
                        <TableHead>{t("import.report.column")}</TableHead>
                        <TableHead>{t("import.report.problem")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.errors.slice(0, MAX_ERRORS_SHOWN).map((error) => (
                        <TableRow key={`${error.row}-${error.column}-${error.code}`}>
                          <TableCell className="tnum font-semibold">{error.row}</TableCell>
                          <TableCell className="code">{error.column}</TableCell>
                          <TableCell>
                            {t(`import.codes.${error.code}`, { defaultValue: error.message })}
                            <span className="block text-xs text-muted-foreground">
                              {error.code}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {report.errors.length > MAX_ERRORS_SHOWN ? (
                  <p className="text-sm text-muted-foreground">
                    {t("import.report.moreErrors", {
                      count: report.errors.length - MAX_ERRORS_SHOWN,
                    })}
                  </p>
                ) : null}
              </>
            ) : (
              <Alert tone="info">
                <span>
                  {forApproval ? t("import.report.cleanApproval") : t("import.report.clean")}
                </span>
              </Alert>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                {hasErrors ? t("import.report.chooseAnother") : t("common.cancel")}
              </Button>
              {!hasErrors && report.ok_rows > 0 ? (
                <Button disabled={importer.isPending} onClick={save}>
                  {importer.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {forApproval
                    ? t("import.report.sendApproval", { count: report.ok_rows })
                    : t("import.report.save", { count: report.ok_rows })}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && outcome ? (
        <Card className="p-10 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-success text-white">
            <Check className="size-9" strokeWidth={3} aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-bold">
            {outcome.kind === "created"
              ? t("import.done.created", { count: outcome.count })
              : t("import.done.sent", { count: outcome.count })}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {outcome.kind === "created" ? t("import.done.createdText") : t("import.done.sentText")}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={reset}>
              {t("import.done.another")}
            </Button>
            <Link
              to={outcome.kind === "created" ? "/admin/employees" : "/admin/my-requests"}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {outcome.kind === "created" ? t("import.done.viewEmployees") : t("nav.myRequests")}
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
