// The "Phone attendance" card on an employee's page (spec M4b §4.12, design gate P3 screen 1).
// The Super Admin switches phone punching and outside work (with a reason), sees the account
// state, the signed-in phones and the passkeys, and can sign every phone out or require a new
// password. The Corporate Head and the Plant Head see the same card read-only, without IP
// addresses. The server decides what is allowed; the card only hides what a role cannot use.
import type { TFunction } from "i18next";
import {
  CalendarClock,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Smartphone,
  SmartphoneNfc,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReasonDialog } from "./reason-dialog";
import {
  type PhoneAdminView,
  usePhoneAdmin,
  useRemovePasskey,
  useRequireNewPassword,
  useSetOutsideWork,
  useSetPhoneAccess,
  useSignOutAllPhones,
} from "./use-phone-admin";

type CardEmployee = { id: string; status: "active" | "left"; punch_method: "face" | "qr" };

type DialogName =
  | { name: "access"; enable: boolean }
  | { name: "outside"; enable: boolean }
  | { name: "signOutAll" }
  | { name: "requireNew" }
  | { name: "removePasskey"; passkeyId: string; label: string };

// A switch that always says "On" or "Off" in words (never colour alone).
function SwitchRow({
  label,
  checked,
  disabled,
  lockedText,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  lockedText?: string;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 border-b border-dashed py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            "inline-flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-full border-2 px-3 text-sm font-bold",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong bg-card",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {checked ? t("phoneAdmin.on") : t("phoneAdmin.off")}
        </button>
      </div>
      {lockedText ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LockKeyhole className="size-3.5" aria-hidden />
          {lockedText}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function accountText(view: PhoneAdminView, t: TFunction): string {
  const { account } = view;
  if (account.state === "locked" && account.locked_until) {
    return t("phoneAdmin.account.locked", { time: formatTime(account.locked_until) });
  }
  if (account.state === "new_password_required") return t("phoneAdmin.account.newPassword");
  if (account.state === "no_password" || !account.password_set_at) {
    return t("phoneAdmin.account.noPassword");
  }
  return t(
    account.proof_kind === "card"
      ? "phoneAdmin.account.activeCard"
      : "phoneAdmin.account.activeFace",
    { date: formatDate(account.password_set_at) },
  );
}

export function PhoneAttendanceCard({
  employee,
  canManage,
}: {
  employee: CardEmployee;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const phone = usePhoneAdmin(employee.id);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [until, setUntil] = useState("");
  const setAccess = useSetPhoneAccess(employee.id);
  const setOutside = useSetOutsideWork(employee.id);
  const signOutAll = useSignOutAllPhones(employee.id);
  const requireNew = useRequireNewPassword(employee.id);
  const removePasskey = useRemovePasskey(employee.id);

  if (phone.isPending) return <Skeleton className="h-48 w-full" />;
  if (phone.isError) {
    return (
      <Alert tone="danger">
        <span>{describeError(phone.error, t)}</span>
      </Alert>
    );
  }
  const view = phone.data;
  const left = employee.status === "left";
  const write = canManage && !left;
  const isFace = employee.punch_method === "face";
  const today = todayIst();
  const untilValid = until === "" || until >= today;

  const outsideLocked = !view.phone_punch_enabled
    ? t("phoneAdmin.outside.lockedOff")
    : !isFace
      ? t("phoneAdmin.outside.lockedQr")
      : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" aria-hidden />
          {t("phoneAdmin.title")}
        </CardTitle>
        {view.phone_punch_enabled ? (
          <Badge tone="primary">
            <Smartphone aria-hidden />
            {t("phoneAdmin.badgeOn")}
          </Badge>
        ) : (
          <Badge className="border border-dashed">
            <SmartphoneNfc aria-hidden />
            {t("phoneAdmin.badgeOff")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!canManage ? <Alert tone="info">{t("phoneAdmin.viewOnly")}</Alert> : null}
        {left ? <Alert tone="warning">{t("phoneAdmin.left")}</Alert> : null}

        <SwitchRow
          label={t("phoneAdmin.switch.phone")}
          checked={view.phone_punch_enabled}
          disabled={!write}
          onToggle={() => setDialog({ name: "access", enable: !view.phone_punch_enabled })}
        />
        <SwitchRow
          label={t("phoneAdmin.switch.outside")}
          checked={view.outside_work_allowed}
          disabled={!write || outsideLocked !== undefined}
          lockedText={outsideLocked}
          onToggle={() => {
            setUntil("");
            setDialog({ name: "outside", enable: !view.outside_work_allowed });
          }}
        >
          {view.outside_work_allowed ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden />
              {view.outside_work_until
                ? t("phoneAdmin.outside.until", {
                    date: formatDate(`${view.outside_work_until}T00:00:00+05:30`),
                  })
                : t("phoneAdmin.outside.noEnd")}
              {write ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setUntil(view.outside_work_until ?? "");
                    setDialog({ name: "outside", enable: true });
                  }}
                >
                  {t("phoneAdmin.outside.change")}
                </Button>
              ) : null}
            </p>
          ) : null}
          {view.outside_work_ended && view.outside_work_until ? (
            <p className="rounded-md border border-dashed px-2 py-1 text-sm text-muted-foreground">
              {t("phoneAdmin.outside.ended", {
                date: formatDate(`${view.outside_work_until}T00:00:00+05:30`),
              })}
            </p>
          ) : null}
        </SwitchRow>

        {!view.phone_punch_enabled ? (
          <p className="pt-2 text-sm text-muted-foreground">{t("phoneAdmin.empty.off")}</p>
        ) : (
          <>
            <section className="space-y-1 border-t pt-3">
              <h3 className="font-semibold">{t("phoneAdmin.account.title")}</h3>
              <p className="text-sm">{accountText(view, t)}</p>
              <p className="text-sm text-muted-foreground">
                {view.notice
                  ? t("phoneAdmin.notice.accepted", {
                      version: view.notice.version,
                      date: formatDate(view.notice.accepted_at),
                    })
                  : t("phoneAdmin.notice.none")}
              </p>
            </section>

            <section className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{t("phoneAdmin.sessions.title")}</h3>
                {write && view.sessions.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ name: "signOutAll" })}
                  >
                    {t("phoneAdmin.signOutAll")}
                  </Button>
                ) : null}
              </div>
              {view.sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("phoneAdmin.sessions.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {view.sessions.map((session) => (
                    <li key={session.id} className="rounded-md border p-2 text-sm">
                      <p className="font-medium">
                        {session.browser} · {session.system}
                      </p>
                      <p className="text-muted-foreground">
                        {t("phoneAdmin.sessions.line", {
                          started: `${formatDate(session.started_at)} ${formatTime(session.started_at)}`,
                          used: `${formatDate(session.last_seen_at)} ${formatTime(session.last_seen_at)}`,
                        })}
                        {session.ip ? ` · ${session.ip}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2 border-t pt-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <Fingerprint className="size-4" aria-hidden />
                {t("phoneAdmin.passkeys.title", { count: view.passkeys.length, max: 3 })}
              </h3>
              {view.passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("phoneAdmin.passkeys.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {view.passkeys.map((passkey) => (
                    <li
                      key={passkey.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{passkey.label}</span>
                        <span className="block text-muted-foreground">
                          {t("phoneAdmin.passkeys.line", {
                            added: formatDate(passkey.created_at),
                            used: passkey.last_used_at ? formatDate(passkey.last_used_at) : "–",
                          })}
                        </span>
                      </span>
                      {write ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            setDialog({
                              name: "removePasskey",
                              passkeyId: passkey.id,
                              label: passkey.label,
                            })
                          }
                        >
                          <Trash2 aria-hidden />
                          {t("phoneAdmin.passkeys.remove")}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {write ? (
              <section className="space-y-1 border-t pt-3">
                <Button variant="outline" onClick={() => setDialog({ name: "requireNew" })}>
                  <KeyRound aria-hidden />
                  {t("phoneAdmin.requireNew")}
                </Button>
                <p className="text-sm text-muted-foreground">{t("phoneAdmin.requireNewNote")}</p>
              </section>
            ) : null}
          </>
        )}
      </CardContent>

      {dialog?.name === "access" ? (
        <ReasonDialog
          title={t(
            dialog.enable ? "phoneAdmin.dialog.enable.title" : "phoneAdmin.dialog.disable.title",
          )}
          description={t(
            dialog.enable ? "phoneAdmin.dialog.enable.desc" : "phoneAdmin.dialog.disable.desc",
          )}
          effects={
            dialog.enable
              ? undefined
              : [
                  t("phoneAdmin.dialog.disable.effectOutside"),
                  t("phoneAdmin.dialog.disable.effectSignOut"),
                  t("phoneAdmin.dialog.disable.effectPassword"),
                ]
          }
          confirmLabel={t(
            dialog.enable
              ? "phoneAdmin.dialog.enable.confirm"
              : "phoneAdmin.dialog.disable.confirm",
          )}
          danger={!dialog.enable}
          onSubmit={(reason) => setAccess.mutateAsync({ enabled: dialog.enable, reason })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.name === "outside" ? (
        <ReasonDialog
          title={t(
            dialog.enable
              ? "phoneAdmin.dialog.outsideOn.title"
              : "phoneAdmin.dialog.outsideOff.title",
          )}
          description={t(
            dialog.enable
              ? "phoneAdmin.dialog.outsideOn.desc"
              : "phoneAdmin.dialog.outsideOff.desc",
          )}
          confirmLabel={t(
            dialog.enable
              ? "phoneAdmin.dialog.outsideOn.confirm"
              : "phoneAdmin.dialog.outsideOff.confirm",
          )}
          danger={!dialog.enable}
          extraValid={!dialog.enable || untilValid}
          extra={
            dialog.enable ? (
              <Field
                id="outside-until"
                label={t("phoneAdmin.outside.untilLabel")}
                hint={t("phoneAdmin.outside.untilHint")}
                error={untilValid ? undefined : t("errors.OUTSIDE_UNTIL_INVALID")}
              >
                <Input
                  id="outside-until"
                  type="date"
                  min={today}
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </Field>
            ) : null
          }
          onSubmit={(reason) =>
            setOutside.mutateAsync({
              allowed: dialog.enable,
              reason,
              until: dialog.enable && until ? until : null,
            })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.name === "signOutAll" ? (
        <ReasonDialog
          title={t("phoneAdmin.dialog.signOutAll.title")}
          description={t("phoneAdmin.dialog.signOutAll.desc", { count: view.sessions.length })}
          confirmLabel={t("phoneAdmin.dialog.signOutAll.confirm", { count: view.sessions.length })}
          onSubmit={async (reason) => {
            const answer = (await signOutAll.mutateAsync({ reason })) as { ended: number };
            toast.success(t("phoneAdmin.toast.signedOut", { count: answer.ended }));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.name === "requireNew" ? (
        <ReasonDialog
          title={t("phoneAdmin.dialog.requireNew.title")}
          description={t("phoneAdmin.dialog.requireNew.desc")}
          effects={[
            t("phoneAdmin.dialog.requireNew.effectOld"),
            t("phoneAdmin.dialog.requireNew.effectPasskeys"),
            t("phoneAdmin.dialog.requireNew.effectPhones"),
          ]}
          confirmLabel={t("phoneAdmin.dialog.requireNew.confirm")}
          danger
          onSubmit={async (reason) => {
            await requireNew.mutateAsync({ reason });
            toast.success(t("phoneAdmin.toast.newPassword"));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.name === "removePasskey" ? (
        <ReasonDialog
          title={t("phoneAdmin.dialog.removePasskey.title")}
          description={t("phoneAdmin.dialog.removePasskey.desc", { label: dialog.label })}
          confirmLabel={t("phoneAdmin.dialog.removePasskey.confirm")}
          danger
          onSubmit={(reason) => removePasskey.mutateAsync({ passkeyId: dialog.passkeyId, reason })}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  );
}
