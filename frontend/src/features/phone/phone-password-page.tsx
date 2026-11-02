// Set your password (spec M4b §4.6, rule 6, design gate P1 screen 3): two fields and a checklist
// that ticks while typing. The checklist only guides; the server checks the rules again and
// answers PASSWORD_TOO_WEAK. The proof token comes from the previous step through router state
// (memory only) and is valid 5 minutes. After saving the person is signed in.
import { Check, Circle, Eye, EyeOff, UserCheck, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import { phoneApi } from "./phone-api";
import { Notice, PhoneButton, PhoneCard, PhoneTitle, StepPills } from "./phone-ui";
import { useAfterSignIn } from "./phone-use-phone";

type ProofState = { proofToken: string; firstName: string; employeeCode: string };

const EASY = new Set(["password", "12345678", "123456789", "qwertyui", "abcd1234", "password1"]);

/** The four rules as the checklist shows them (spec §7 rule 6). */
export function passwordRules(password: string, employeeCode: string) {
  const lower = password.toLowerCase();
  return {
    length: password.length >= 8,
    notOnlyNumbers: password.length > 0 && !/^\d+$/.test(password),
    notCode: password.length > 0 && lower !== employeeCode.toLowerCase(),
    notEasy: password.length > 0 && !EASY.has(lower) && new Set(password).size > 2,
  };
}

function RuleLine({ ok, typed, text }: { ok: boolean; typed: boolean; text: string }) {
  const { t } = useTranslation();
  const Icon = ok ? Check : typed ? X : Circle;
  return (
    <li className="flex items-center gap-2 text-lg">
      <Icon
        className={
          ok
            ? "size-5 text-success"
            : typed
              ? "size-5 text-destructive"
              : "size-5 text-muted-foreground"
        }
        aria-hidden
      />
      <span className="flex-1">{text}</span>
      <span className="text-base font-semibold text-muted-foreground">
        {ok ? t("phone.password.done") : t("phone.password.notYet")}
      </span>
    </li>
  );
}

export function PhonePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const proof = useLocation().state as ProofState | null;
  const afterSignIn = useAfterSignIn();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);

  if (!proof?.proofToken) return <Navigate to="/phone/setup" replace />;

  const rules = passwordRules(password, proof.employeeCode);
  const allRules = Object.values(rules).every(Boolean);
  const mismatch = again.length > 0 && again !== password;
  const proofExpired = problem instanceof ApiError && problem.code === "PROOF_TOKEN_INVALID";

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const answer = await phoneApi.setPassword({
        proof_token: proof.proofToken,
        new_password: password,
      });
      await afterSignIn(answer);
      navigate(answer.notice_required ? "/phone/notice" : "/phone", { replace: true });
    } catch (error) {
      setProblem(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepPills current={2} labels={[t("phone.setup.stepCheck"), t("phone.setup.stepPassword")]} />
      <PhoneTitle>{t("phone.password.title")}</PhoneTitle>
      <Notice tone="success" icon={UserCheck}>
        {t("phone.password.passed", { name: proof.firstName })}
      </Notice>
      <PhoneCard>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (allRules && !mismatch && again) void save();
          }}
        >
          <Field id="new-password" label={t("phone.password.new")}>
            <div className="relative">
              <Input
                id="new-password"
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                className="h-15 pr-16 text-xl"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                aria-pressed={shown}
                aria-label={shown ? t("phone.login.hide") : t("phone.login.show")}
                onClick={() => setShown((current) => !current)}
                className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center rounded-md text-primary"
              >
                {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            </div>
          </Field>
          <Field
            id="again-password"
            label={t("phone.password.again")}
            error={mismatch ? t("phone.password.mismatch") : undefined}
          >
            <Input
              id="again-password"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              className="h-15 text-xl"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          </Field>
          <ul aria-live="polite" className="space-y-2 rounded-lg bg-muted p-4">
            <RuleLine
              ok={rules.length}
              typed={password.length > 0}
              text={t("phone.password.rule.length")}
            />
            <RuleLine
              ok={rules.notOnlyNumbers}
              typed={password.length > 0}
              text={t("phone.password.rule.notOnlyNumbers")}
            />
            <RuleLine
              ok={rules.notCode}
              typed={password.length > 0}
              text={t("phone.password.rule.notCode")}
            />
            <RuleLine
              ok={rules.notEasy}
              typed={password.length > 0}
              text={t("phone.password.rule.notEasy")}
            />
          </ul>
          <PhoneButton type="submit" busy={saving} disabled={!allRules || mismatch || !again}>
            {saving ? t("phone.password.saving") : t("phone.password.save")}
          </PhoneButton>
          <p className="text-base text-muted-foreground">{t("phone.password.validFor")}</p>
        </form>
        {problem ? (
          <Notice tone="danger" className="mt-4">
            {describeError(problem, t)}
          </Notice>
        ) : null}
        {proofExpired ? (
          <Link to="/phone/setup" replace className="mt-4 block">
            <span className="inline-flex h-15 w-full items-center justify-center rounded-md border border-border-strong bg-card text-lg font-semibold">
              {t("phone.password.checkAgain")}
            </span>
          </Link>
        ) : null}
      </PhoneCard>
    </>
  );
}
