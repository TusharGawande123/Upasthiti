// Set a new password (spec §4.1): shown after the first login with a temporary password,
// and reachable later from the user menu. The rules are shown as a checklist (icon + text).
import { Check, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { describeError } from "./error-message";
import { useChangePassword, useMe } from "./use-auth";

const MINIMUM_LENGTH = 10;

export function passwordRuleResults(password: string, username: string) {
  return {
    length: password.length >= MINIMUM_LENGTH,
    notOnlyDigits: password.length > 0 && !/^\d+$/.test(password),
    notLoginName: password.length > 0 && password.toLowerCase() !== username.toLowerCase(),
  };
}

export function NewPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  if (me.isPending) {
    return null;
  }
  if (!me.data) {
    return <Navigate to="/admin/login" replace />;
  }

  const rules = passwordRuleResults(newPassword, me.data.username);
  const allRulesPass = rules.length && rules.notOnlyDigits && rules.notLoginName;
  const matches = newPassword.length > 0 && newPassword === repeat;
  const mismatch = repeat.length > 0 && newPassword !== repeat;

  const ruleRows: [boolean, string][] = [
    [rules.length, t("newPassword.ruleLength", { count: MINIMUM_LENGTH })],
    [rules.notOnlyDigits, t("newPassword.ruleNotDigits")],
    [rules.notLoginName, t("newPassword.ruleNotLogin")],
    [matches, t("newPassword.ruleMatch")],
  ];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    change.mutate(
      { current_password: currentPassword, new_password: newPassword },
      { onSuccess: () => navigate("/admin", { replace: true }) },
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-110 space-y-4 rounded-xl border bg-card p-8 shadow-md"
      >
        <h1 className="text-2xl font-bold">{t("newPassword.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {me.data.must_change_password
            ? t("newPassword.subtitleFirst")
            : t("newPassword.subtitleLater")}
        </p>
        {change.error ? (
          <Alert tone="danger">
            <span>{describeError(change.error, t)}</span>
          </Alert>
        ) : null}
        <Field id="current" label={t("newPassword.current")}>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field id="new" label={t("newPassword.new")}>
          <Input
            id="new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-describedby="password-rules"
          />
        </Field>
        <Field
          id="repeat"
          label={t("newPassword.repeat")}
          error={mismatch ? t("newPassword.mismatch") : undefined}
        >
          <Input
            id="repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            aria-invalid={mismatch}
          />
        </Field>
        <ul id="password-rules" className="space-y-1 text-[13px]">
          {ruleRows.map(([passed, text]) => (
            <li key={text} className="flex items-center gap-2">
              {passed ? (
                <Check className="size-4 text-success" aria-hidden />
              ) : (
                <Circle className="size-4 text-subtle-foreground" aria-hidden />
              )}
              <span className={passed ? "text-success" : "text-muted-foreground"}>
                {text}
                <span className="sr-only">
                  {" "}
                  {passed ? t("newPassword.done") : t("newPassword.notYet")}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">{t("newPassword.logsOutOthers")}</p>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!allRulesPass || !matches || !currentPassword || change.isPending}
        >
          {change.isPending ? <Loader2 className="animate-spin" /> : null}
          {t("newPassword.submit")}
        </Button>
      </form>
    </main>
  );
}
