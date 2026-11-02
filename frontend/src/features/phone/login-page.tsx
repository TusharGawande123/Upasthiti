// Phone sign in (spec M4b §4.4, design gate P1 screen 1): employee code + password, and, when the
// browser can, "Sign in with passkey" (F-80). One wrong-password text for every cause, so the
// screen never says whether a code exists.
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Fingerprint, UserRoundX } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import { PasskeyCancelled, passkeysSupported, signWithPasskey } from "./passkey-support";
import { phoneApi, type SignedIn } from "./phone-api";
import { phoneBrowserSupported } from "./phone-browser";
import { Notice, PhoneButton, PhoneCard, PhoneTitle, ProblemCard } from "./phone-ui";
import { useAfterSignIn } from "./use-phone";

const loginSchema = z.object({
  employee_code: z.string().trim().min(1, "codeRequired"),
  password: z.string().min(1, "passwordRequired"),
});
type LoginForm = z.infer<typeof loginSchema>;

export function PhoneLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const afterSignIn = useAfterSignIn();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [passkeyOffered, setPasskeyOffered] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const endedNotice = (location.state as { notice?: string } | null)?.notice;
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    let cancelled = false;
    void passkeysSupported().then((supported) => {
      if (!cancelled) setPasskeyOffered(supported);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!phoneBrowserSupported()) {
    return (
      <ProblemCard icon={UserRoundX} tone="grey" title={t("errors.PHONE_BROWSER_UNSUPPORTED")} />
    );
  }

  const finish = async (answer: SignedIn) => {
    await afterSignIn(answer);
    navigate(answer.notice_required ? "/phone/notice" : "/phone", { replace: true });
  };

  const onSubmit = async (values: LoginForm) => {
    setBusy("password");
    setProblem(null);
    setPasskeyMessage(null);
    try {
      await finish(await phoneApi.login(values));
    } catch (error) {
      setProblem(error);
    } finally {
      setBusy(null);
    }
  };

  const onPasskey = async () => {
    const code = getValues("employee_code").trim();
    if (!code) {
      setError("employee_code", { message: "codeRequired" });
      return;
    }
    setBusy("passkey");
    setProblem(null);
    setPasskeyMessage(null);
    try {
      const { options } = await phoneApi.passkeyLoginOptions(code);
      const credential = await signWithPasskey(options);
      await finish(await phoneApi.passkeyLogin({ employee_code: code, credential }));
    } catch (error) {
      if (error instanceof PasskeyCancelled) setPasskeyMessage("errors.PASSKEY_CANCELLED");
      else setProblem(error);
    } finally {
      setBusy(null);
    }
  };

  const locked = problem instanceof ApiError && problem.code === "PHONE_ACCOUNT_LOCKED";

  return (
    <>
      <PhoneTitle hint={t("phone.login.subtitle")}>{t("phone.login.title")}</PhoneTitle>
      {endedNotice ? (
        <Notice tone={endedNotice === "PHONE_PUNCH_OFF" ? "danger" : "warning"}>
          {t(`errors.${endedNotice}`)}
        </Notice>
      ) : null}
      <PhoneCard>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field
            id="employee_code"
            label={t("phone.login.code")}
            error={
              errors.employee_code ? t(`phone.login.${errors.employee_code.message}`) : undefined
            }
          >
            <Input
              id="employee_code"
              className="h-15 font-mono text-xl uppercase"
              autoComplete="username"
              autoCapitalize="characters"
              inputMode="text"
              disabled={busy !== null}
              {...register("employee_code", {
                onChange: (event) => setValue("employee_code", event.target.value.toUpperCase()),
              })}
            />
          </Field>
          <Field
            id="password"
            label={t("phone.login.password")}
            error={errors.password ? t(`phone.login.${errors.password.message}`) : undefined}
          >
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                className="h-15 pr-16 text-xl"
                autoComplete="current-password"
                disabled={busy !== null}
                {...register("password")}
              />
              <button
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? t("phone.login.hide") : t("phone.login.show")}
                onClick={() => setShowPassword((current) => !current)}
                className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center rounded-md text-primary"
              >
                {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            </div>
          </Field>
          <PhoneButton type="submit" busy={busy === "password"} disabled={busy !== null || locked}>
            {busy === "password" ? t("phone.login.submitting") : t("phone.login.submit")}
          </PhoneButton>
        </form>

        {problem ? (
          <Notice tone={locked ? "warning" : "danger"} className="mt-4">
            {describeError(problem, t)}
          </Notice>
        ) : null}

        {passkeyOffered ? (
          <div className="mt-5 space-y-3">
            <p className="text-center text-base text-muted-foreground">{t("phone.login.or")}</p>
            <PhoneButton
              variant="outline"
              busy={busy === "passkey"}
              onClick={onPasskey}
              disabled={busy !== null}
            >
              <Fingerprint aria-hidden />
              {t("phone.login.passkey")}
            </PhoneButton>
            {busy === "passkey" ? (
              <p className="text-base text-muted-foreground">{t("phone.login.passkeyWaiting")}</p>
            ) : (
              <p className="text-base text-muted-foreground">{t("phone.login.passkeyHint")}</p>
            )}
            {passkeyMessage ? <Notice tone="warning">{t(passkeyMessage)}</Notice> : null}
          </div>
        ) : null}

        <p className="mt-5 text-center">
          <Link to="/phone/setup" className="text-lg font-semibold text-primary underline">
            {t("phone.login.forgot")}
          </Link>
        </p>
      </PhoneCard>
    </>
  );
}
