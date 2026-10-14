// One employee: details, plant and shift history, and the timeline built from the audit log
// (F-19). Actions depend on the role: the Super Admin edits, transfers, marks as left and
// reactivates; a Corporate Head's edits and transfers go for approval; a Plant Head only reads.
import {
  ArrowRightLeft,
  CirclePlus,
  Hourglass,
  LogOut,
  Pencil,
  RotateCcw,
  Undo2,
  UserCog,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { formatDate, formatRupees, formatTime } from "@/lib/format";
import { EmployeeStatusBadge, initialsOf, TypeBadge } from "./employee-badges";
import { MarkLeftDialog, ReactivateDialog, TransferDialog } from "./employee-dialogs";
import { useEmployee, useTimeline } from "./use-employees";

const EVENT_ICONS: Record<string, typeof Pencil> = {
  "employee.create": CirclePlus,
  "employee.update": Pencil,
  "employee.transfer": ArrowRightLeft,
  "employee.bulk": UserCog,
  "employee.import": CirclePlus,
  "employee.mark_left": LogOut,
  "employee.reactivate": Undo2,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-dashed py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export function EmployeeDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId = "" } = useParams();
  const me = useMe();
  const role = me.data?.role;
  const detail = useEmployee(employeeId);
  const timeline = useTimeline(employeeId);
  const [dialog, setDialog] = useState<"transfer" | "left" | "reactivate" | null>(null);

  if (detail.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Alert tone="danger">{describeError(detail.error, t)}</Alert>
        <Link to="/admin/employees" className="text-sm font-semibold text-primary underline">
          {t("employees.backToList")}
        </Link>
      </div>
    );
  }
  if (detail.isPending) return <Skeleton className="mx-auto h-64 max-w-6xl" />;

  const { employee, plant_history: plantHistory, shift_history: shiftHistory } = detail.data;
  const canChange = role === "super_admin" || role === "corporate_head";
  const isLeft = employee.status === "left";
  const field = (key: string) => t(`employees.fields.${key}`, { defaultValue: key });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <nav aria-label={t("common.breadcrumb")} className="text-[13px] text-muted-foreground">
        <Link to="/admin/employees" className="hover:underline">
          {t("employees.title")}
        </Link>
        <span aria-hidden> › </span>
        <span>
          {employee.employee_code} {employee.full_name}
        </span>
      </nav>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="grid size-16 place-items-center rounded-full bg-primary-soft text-xl font-bold text-primary-soft-foreground">
            {initialsOf(employee.full_name)}
          </span>
          <div className="space-y-1.5">
            <p className="text-[13px] text-muted-foreground">
              {t("employees.detail.codeLine", { code: employee.employee_code })}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{employee.full_name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={employee.type} />
              <EmployeeStatusBadge status={employee.status} />
              <Badge tone="neutral">
                <span className="code font-bold">{employee.plant_code}</span>
              </Badge>
            </div>
          </div>
        </div>
        {canChange ? (
          <div className="flex flex-wrap gap-2">
            {!isLeft ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => navigate(`/admin/employees/${employee.id}/edit`)}
                >
                  <Pencil aria-hidden />
                  {t("employees.edit")}
                </Button>
                <Button variant="outline" onClick={() => setDialog("transfer")}>
                  <ArrowRightLeft aria-hidden />
                  {t("employees.transfer.button")}
                </Button>
              </>
            ) : null}
            {role === "super_admin" && !isLeft ? (
              <Button variant="danger" onClick={() => setDialog("left")}>
                <LogOut aria-hidden />
                {t("employees.markLeft")}
              </Button>
            ) : null}
            {role === "super_admin" && isLeft ? (
              <Button onClick={() => setDialog("reactivate")}>
                <RotateCcw aria-hidden />
                {t("employees.reactivate.button")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {employee.has_pending_change ? (
        <Alert tone="warning" className="items-center">
          <Hourglass aria-hidden />
          <span>
            <b>{t("employees.detail.pendingTitle")}</b> {t("employees.detail.pendingText")}
          </span>
          {role === "super_admin" ? (
            <Link
              to="/admin/approvals"
              className="ml-auto inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground"
            >
              {t("employees.detail.review")}
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {isLeft ? (
        <Alert tone="info">
          <span>
            {t("employees.detail.leftNote", {
              date: employee.left_on ? formatDate(employee.left_on) : "–",
              reason: employee.left_reason ?? "–",
            })}
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t("employees.detail.details")}</CardTitle>
              <Badge tone="neutral">
                {employee.punch_method === "face"
                  ? t("employees.punch.face")
                  : t("employees.punch.qr")}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                <Row label={t("employees.columns.code")}>{employee.employee_code}</Row>
                <Row label={t("employees.form.joinedOn")}>{formatDate(employee.joined_on)}</Row>
                <Row label={t("employees.form.fullName")}>{employee.full_name}</Row>
                <Row label={t("employees.form.type")}>{t(`employees.type.${employee.type}`)}</Row>
                <Row label={t("employees.columns.plant")}>{employee.plant_code}</Row>
                <Row label={t("employees.columns.category")}>{employee.category_name}</Row>
                <Row label={t("employees.columns.department")}>
                  {employee.department_name ?? "–"}
                </Row>
                <Row label={t("employees.columns.shift")}>{employee.shift_name ?? "–"}</Row>
                {employee.type === "temporary" ? (
                  <>
                    <Row label={t("employees.columns.contractor")}>
                      {employee.contractor_name ?? "–"}
                    </Row>
                    <Row label={t("employees.form.hourlyRate")}>
                      {employee.hourly_rate ? `${formatRupees(employee.hourly_rate)}/h` : "–"}
                    </Row>
                  </>
                ) : null}
                <Row label={t("employees.form.otRate")}>
                  {employee.ot_rate_per_hour ? `${formatRupees(employee.ot_rate_per_hour)}/h` : "–"}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("employees.detail.plantHistory")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {plantHistory.map((item) => (
                  <li
                    key={`${item.plant_id}-${item.from_date}`}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="code rounded-md bg-primary-soft px-2 py-1 font-bold">
                      {item.plant_code}
                    </span>
                    <span>
                      {t("employees.detail.sinceTo", {
                        from: formatDate(item.from_date),
                        to: item.to_date ? formatDate(item.to_date) : t("employees.detail.now"),
                      })}
                      {item.reason ? (
                        <span className="block text-xs text-muted-foreground">{item.reason}</span>
                      ) : null}
                    </span>
                    <Badge tone={item.to_date ? "neutral" : "success"} className="ml-auto">
                      {item.to_date ? t("employees.detail.past") : t("employees.detail.current")}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("employees.detail.shiftHistory")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {shiftHistory.map((item) => (
                  <li
                    key={`${item.shift_id}-${item.from_date}`}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{item.shift_name}</span>
                    <span className="tnum text-muted-foreground">
                      {formatDate(item.from_date)} –{" "}
                      {item.to_date ? formatDate(item.to_date) : t("employees.detail.now")}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t("employees.detail.timeline")}</CardTitle>
            <p className="text-[13px] text-muted-foreground">
              {t("employees.detail.timelineNote")}
            </p>
          </CardHeader>
          <CardContent>
            {timeline.isError ? (
              <Alert tone="danger">{describeError(timeline.error, t)}</Alert>
            ) : null}
            {timeline.isPending ? <Skeleton className="h-32 w-full" /> : null}
            <ol className="space-y-4">
              {timeline.data?.map((event) => {
                const Icon = EVENT_ICONS[event.action] ?? Pencil;
                return (
                  <li key={`${event.at}-${event.action}`} className="flex gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">
                        {t(`employees.events.${event.action}`, { defaultValue: event.action })}
                      </p>
                      <p className="tnum text-[13px] text-muted-foreground">
                        {formatDate(event.at)} {formatTime(event.at)}
                        {event.actor_name ? ` · ${event.actor_name}` : ""}
                        {event.approved_through_request
                          ? ` · ${t("employees.events.approved")}`
                          : ""}
                      </p>
                      {event.changed_fields.length > 0 ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {event.changed_fields.map((name) => (
                            <Badge key={name} tone="neutral">
                              {field(name)}
                            </Badge>
                          ))}
                        </p>
                      ) : null}
                      {event.reason ? (
                        <p className="mt-1 rounded-md bg-muted px-2 py-1 text-[13px]">
                          {event.reason}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      {dialog === "transfer" ? (
        <TransferDialog
          employee={employee}
          forApproval={role === "corporate_head"}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "left" ? (
        <MarkLeftDialog employee={employee} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "reactivate" ? (
        <ReactivateDialog employee={employee} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
