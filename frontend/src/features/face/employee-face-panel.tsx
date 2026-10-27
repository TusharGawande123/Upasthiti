// The face panel on an employee's page (spec M3 §4.7). Shows the face state, the actions of the
// Super Admin (enrol, re-enrol, delete face data, withdraw consent) and the face history. Other
// roles see the same state read-only. No one ever sees a template: the server sends none.
import {
  History,
  IdCard,
  PencilLine,
  QrCode,
  ScanFace,
  ShieldOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, Card as Panel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime } from "@/lib/format";
import { ConsentDialog } from "./consent-dialog";
import { EnrolmentWizard } from "./enrolment-wizard";
import { FaceStateBadge } from "./face-badges";
import { DeleteFaceDataDialog, WithdrawConsentDialog } from "./face-dialogs";
import { type EmployeeFace, type HistoryItem, useEmployeeFace } from "./use-face";

type PanelEmployee = {
  id: string;
  full_name: string;
  employee_code: string;
  plant_code: string;
  punch_method: "face" | "qr";
  status: "active" | "left";
};

type DialogName = "consent" | "wizard" | "withdraw" | "delete" | null;

function hasActiveConsent(face: EmployeeFace): boolean {
  return face.consent?.choice === "agreed" && face.consent.withdrawn_at === null;
}

/** The face state, with the re-enrol hint (F-41) shown in place of "Enrolled". */
function shownState(face: EmployeeFace) {
  if (face.face_state === "enrolled" && face.reenrol_suggested) return "reenrol_suggested";
  return face.face_state;
}

/** The line under the state: when, by whom, which model, why re-enrol. */
function StateLine({ face }: { face: EmployeeFace }) {
  const { t } = useTranslation();
  const state = shownState(face);
  if (face.template && (state === "enrolled" || state === "reenrol_suggested")) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("face.panel.enrolledLine", {
          date: formatDate(face.template.enrolled_at),
          name: face.template.enrolled_by?.name ?? "–",
          model: face.template.model_id,
          count: face.template.shot_count,
        })}
      </p>
    );
  }
  if (face.template && state === "old_model") {
    return (
      <p className="text-sm text-muted-foreground">
        {t("face.panel.oldModelLine", {
          date: formatDate(face.template.enrolled_at),
          model: face.template.model_id,
        })}
      </p>
    );
  }
  if (state === "not_enrolled") {
    return (
      <p className="text-sm text-muted-foreground">
        {hasActiveConsent(face) && face.consent
          ? t("face.panel.consentGiven", { date: formatDate(face.consent.given_at) })
          : t("face.panel.noConsent")}
      </p>
    );
  }
  return null;
}

function HistoryList({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
        <History className="size-4" aria-hidden />
        {t("face.panel.history")}
        <Badge tone="neutral">{items.length}</Badge>
      </summary>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.at}`}
            className="flex flex-wrap gap-x-3 px-4 py-2.5 text-sm"
          >
            <b>{t(`face.history.${item.kind}`, { defaultValue: item.kind })}</b>
            <span className="tnum text-muted-foreground">
              {formatDate(item.at)} {formatTime(item.at)} ·{" "}
              {item.by?.name ?? t("face.history.system")}
            </span>
            {item.detail ? (
              <span className="text-muted-foreground">
                · {t(`face.history.detail.${item.detail}`, { defaultValue: item.detail })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function EmployeeFacePanel({
  employee,
  canManage,
}: {
  employee: PanelEmployee;
  // True only for the Super Admin (decision 0016 item 3): the buttons are hidden otherwise.
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const face = useEmployeeFace(employee.id);
  const [dialog, setDialog] = useState<DialogName>(null);
  // Ctrl+K "Enrol face…" opens this page with ?face=enrol: start the enrolment once, then tidy the address.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsEnrolment = searchParams.get("face") === "enrol";
  const faceData = face.data;
  useEffect(() => {
    if (!wantsEnrolment || !faceData) return;
    if (canManage && employee.status === "active" && faceData.punch_method === "face") {
      setDialog(hasActiveConsent(faceData) ? "wizard" : "consent");
    }
    setSearchParams(
      (current) => {
        current.delete("face");
        return current;
      },
      { replace: true },
    );
  }, [wantsEnrolment, faceData, canManage, employee.status, setSearchParams]);

  if (face.isError) return <Alert tone="danger">{describeError(face.error, t)}</Alert>;
  if (face.isPending) return <Skeleton className="h-40 w-full" />;

  const data = face.data;
  const active = employee.status === "active";
  const isFace = data.punch_method === "face";
  const state = shownState(data);
  const enrolled = data.template !== null;
  const mayChange = canManage && active;
  // After a withdrawal or "No, I prefer a QR card" the employee needs a card now.
  const switchedToQr = !isFace && data.consent !== null && data.consent.withdraw_kind !== "left";

  const startEnrolment = () => setDialog(hasActiveConsent(data) ? "wizard" : "consent");

  return (
    <Panel>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ScanFace className="size-5" aria-hidden />
          {t("face.panel.title")}
        </CardTitle>
        {isFace ? <FaceStateBadge state={state} /> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {isFace ? (
          <>
            <StateLine face={data} />
            {state === "reenrol_suggested" ? (
              <Alert tone="warning">
                <TriangleAlert aria-hidden />
                <span>
                  {t(`face.panel.reenrolReason.${data.reenrol_reason ?? "code_entries"}`)}
                </span>
              </Alert>
            ) : null}
            {state === "old_model" ? (
              <Alert tone="warning">
                <TriangleAlert aria-hidden />
                <span>{t("face.panel.oldModelText")}</span>
              </Alert>
            ) : null}
            {mayChange ? (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button onClick={startEnrolment}>
                  <ScanFace aria-hidden />
                  {enrolled ? t("face.panel.reenrol") : t("face.panel.enrol")}
                </Button>
                {enrolled ? (
                  <Button variant="outline" onClick={() => setDialog("delete")}>
                    <Trash2 aria-hidden />
                    {t("face.panel.delete")}
                  </Button>
                ) : null}
                {hasActiveConsent(data) ? (
                  <Button
                    variant="danger"
                    className="ml-auto"
                    onClick={() => setDialog("withdraw")}
                  >
                    <ShieldOff aria-hidden />
                    {t("face.panel.withdraw")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm">
              <QrCode className="size-4 text-muted-foreground" aria-hidden />
              {t("face.panel.qrMethod")}
            </p>
            {switchedToQr && mayChange ? (
              <Alert tone="info" className="items-center">
                <IdCard aria-hidden />
                <span>{t("face.panel.nowQr")}</span>
                <Link
                  to="?issue=card"
                  className="ml-auto inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground"
                >
                  {t("face.panel.issueCard")}
                </Link>
              </Alert>
            ) : null}
            {mayChange ? (
              // Changing the punch method is the normal edit of the employee (M1), audited there.
              <Link
                to={`/admin/employees/${employee.id}/edit`}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-card px-4 text-sm font-semibold shadow-xs hover:bg-muted"
              >
                <PencilLine className="size-4" aria-hidden />
                {t("face.panel.changeToFace")}
              </Link>
            ) : null}
          </>
        )}

        <HistoryList items={data.history} />
      </CardContent>

      {dialog === "consent" ? (
        <ConsentDialog
          employee={{ id: employee.id, name: employee.full_name }}
          onAgreed={() => setDialog("wizard")}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "wizard" ? (
        <EnrolmentWizard employee={employee} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "withdraw" ? (
        <WithdrawConsentDialog
          employee={{ id: employee.id, name: employee.full_name }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <DeleteFaceDataDialog
          employee={{ id: employee.id, name: employee.full_name }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Panel>
  );
}
