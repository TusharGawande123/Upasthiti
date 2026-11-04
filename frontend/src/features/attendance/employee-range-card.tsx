// One employee over any period (M5c, "Date range" list of the Attendance tab): a row for every
// day with IN, OUT, hours, status, late and early exit, the totals of the period, and the Excel and
// PDF files. The PDF is the print-friendly sheet (F-89). Up to 366 days.
import { FileDown, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime, todayIst } from "@/lib/format";
import { formatDuration } from "./attendance-format";
import { RangePresetButtons } from "./range-preset-buttons";
import { daysInRange, presetRange } from "./range-presets";
import { totalColumns } from "./register-shared";
import { StatusChip } from "./status-chip";
import { downloadEmployeeRange, saveFile, useEmployeeRange } from "./use-attendance-admin";
import { useDayDrawer } from "./use-day-drawer";

const MAX_DAYS = 366;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "sun";
}

export function EmployeeRangeCard({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { openDay } = useDayDrawer();
  const [dateFrom, setDateFrom] = useState(presetRange("last30", todayIst()).from);
  const [dateTo, setDateTo] = useState(todayIst());
  const [fileError, setFileError] = useState<unknown>(null);
  const [filePending, setFilePending] = useState(false);

  const days = daysInRange(dateFrom, dateTo);
  const valid = dateFrom !== "" && dateTo !== "" && dateTo >= dateFrom && days <= MAX_DAYS;
  const range = useEmployeeRange(employeeId, { date_from: dateFrom, date_to: dateTo }, valid);
  const data = range.data;
  const pending = data?.preparing.pending_days ?? 0;
  const types = Object.keys(data?.totals_by_type ?? {});
  const typeChanged = (data?.type_changes.length ?? 0) > 1;

  const download = async (file: "xlsx" | "pdf") => {
    setFilePending(true);
    setFileError(null);
    try {
      saveFile(
        await downloadEmployeeRange(file, { employeeId, dateFrom, dateTo }),
        `attendance-${dateFrom}-${dateTo}.${file}`,
      );
    } catch (failure) {
      setFileError(failure);
    } finally {
      setFilePending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <CardTitle>{t("attendance.employee.range.title")}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!valid || filePending}
            onClick={() => download("xlsx")}
          >
            <FileSpreadsheet aria-hidden />
            {t("attendance.downloadExcel")}
          </Button>
          <Button
            variant="outline"
            disabled={!valid || filePending}
            onClick={() => download("pdf")}
          >
            <FileDown aria-hidden />
            {t("attendance.employee.range.printSheet")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="employee-range-from" label={t("attendance.register.from")}>
            <Input
              id="employee-range-from"
              type="date"
              value={dateFrom}
              max={todayIst()}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </Field>
          <Field id="employee-range-to" label={t("attendance.register.to")}>
            <Input
              id="employee-range-to"
              type="date"
              value={dateTo}
              max={todayIst()}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </Field>
          <RangePresetButtons
            onPick={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />
        </div>
        {!valid ? (
          <p className="text-sm text-destructive">
            {dateTo < dateFrom
              ? t("attendance.register.rangeBackwards")
              : t("attendance.register.rangeTooLong", { days: MAX_DAYS })}
          </p>
        ) : null}
        {fileError ? (
          <Alert tone="danger">
            <TriangleAlert aria-hidden />
            {describeError(fileError, t)}
          </Alert>
        ) : null}
        {range.isError && !data ? (
          <Alert tone="danger">{describeError(range.error, t)}</Alert>
        ) : null}
        {pending > 0 ? (
          <div role="status" className="rounded-md bg-primary-soft/50 p-3 text-sm">
            <p className="font-semibold">{t("attendance.register.preparing")}</p>
            <p className="text-muted-foreground">
              {t("attendance.register.preparingDays", { count: pending })}
            </p>
          </div>
        ) : null}
        {range.isPending && valid ? <Skeleton className="h-40" /> : null}
        {data ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {totalColumns(data.totals, t).map((column) => (
                <div key={column.key} className="min-w-0 rounded-md border p-2.5">
                  <dt className="text-xs text-muted-foreground">{column.label}</dt>
                  <dd className="tnum text-lg font-bold">{column.value}</dd>
                </div>
              ))}
            </dl>
            {types.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                {types
                  .map((name) =>
                    t("attendance.employee.range.splitLine", {
                      type: t(`attendance.type.${name}`),
                      present: data.totals_by_type[name]?.present ?? 0,
                      hours: formatDuration(data.totals_by_type[name]?.worked_min ?? 0),
                    }),
                  )
                  .join(" · ")}
              </p>
            ) : null}
            {data.days.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("attendance.employee.range.empty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-muted text-xs">
                    <tr>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.date")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.in")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.out")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.hours")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.status")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.late")}
                      </th>
                      <th scope="col" className="p-2">
                        {t("attendance.employee.range.early")}
                      </th>
                      {typeChanged ? (
                        <th scope="col" className="p-2">
                          {t("attendance.employee.range.type")}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr key={day.date} className="border-t">
                        <th scope="row" className="p-2 font-normal whitespace-nowrap">
                          <button
                            type="button"
                            className="cursor-pointer font-semibold text-primary underline"
                            onClick={() => openDay(employeeId, day.date)}
                          >
                            {formatDate(day.date)}
                          </button>{" "}
                          <span className="text-xs text-muted-foreground">
                            {t(`attendance.weekday.${weekdayOf(day.date)}`)}
                          </span>
                        </th>
                        <td className="tnum p-2">
                          {day.first_in ? formatTime(day.first_in) : "–"}
                        </td>
                        <td className="tnum p-2">
                          {day.last_out ? formatTime(day.last_out) : "–"}
                        </td>
                        <td className="tnum p-2">
                          {day.worked_min ? formatDuration(day.worked_min) : "–"}
                        </td>
                        <td className="p-2">
                          <StatusChip day={day} />
                          {day.is_corrected ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {t("attendance.employee.range.corrected")}
                            </span>
                          ) : null}
                        </td>
                        <td className="tnum p-2">
                          {day.late_min ? t("common.minutesShort", { count: day.late_min }) : "–"}
                        </td>
                        <td className="tnum p-2">
                          {day.early_exit_min
                            ? t("common.minutesShort", { count: day.early_exit_min })
                            : "–"}
                        </td>
                        {typeChanged ? (
                          <td className="p-2">{t(`attendance.type.${day.employee_type}`)}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
