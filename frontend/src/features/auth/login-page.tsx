// Login screen (spec §4.1): username or email + password. One error message for both
// "no such user" and "wrong password", so names cannot be guessed.
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { BrandMark } from "./brand-mark";
import { useLogin, useMe } from "./use-auth";

const loginSchema = z.object({
  login: z.string().trim().min(1, "login.required"),
  password: z.string().min(1, "password.required"),
});
type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const login = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  // After logging in, go back to the page the user wanted (kept by RequireAuth).
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/admin";

  if (me.data) {
    return (
      <Navigate to={me.data.must_change_password ? "/admin/new-password" : returnTo} replace />
    );
  }

  const onSubmit = (values: LoginForm) =>
    login.mutate(values, {
      onSuccess: (user) =>
        navigate(user.must_change_password ? "/admin/new-password" : returnTo, { replace: true }),
    });

  const error = login.error;
  const isLocked = error instanceof ApiError && error.code === "ACCOUNT_LOCKED";
  const isWaking = error instanceof ApiError && error.code === "NETWORK_ERROR";

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-primary-soft to-background p-12 lg:flex">
        <BrandMark />
        <div className="max-w-md">
          <h1 className="text-[40px] font-bold leading-[1.12] tracking-tight">
            {t("login.headline")}
          </h1>
          <p className="mt-4 text-[15px] text-muted-foreground">{t("login.subheadline")}</p>
        </div>
        <p className="text-[13px] text-subtle-foreground">{t("login.footer")}</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-110 rounded-xl border bg-card p-8 shadow-md">
          <div className="mb-6 lg:hidden">
            <BrandMark />
          </div>
          <h2 className="text-2xl font-bold">{t("login.title")}</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("login.subtitle")}</p>

          {error ? (
            <Alert tone={isLocked ? "warning" : "danger"} className="mb-4">
              {isLocked ? <Lock /> : <CircleAlert />}
              <span>
                {isLocked
                  ? t("errors.ACCOUNT_LOCKED", { minutes_left: error.details.minutes_left })
                  : isWaking
                    ? t("common.serverWaking")
                    : t(`errors.${(error as ApiError).code}`, {
                        defaultValue: t("errors.UNKNOWN"),
                      })}
              </span>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field
              id="login"
              label={t("login.loginLabel")}
              error={errors.login ? t(`validation.${errors.login.message}`) : undefined}
            >
              <Input
                id="login"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(errors.login)}
                {...register("login")}
              />
            </Field>
            <Field
              id="password"
              label={t("login.passwordLabel")}
              error={errors.password ? t(`validation.${errors.password.message}`) : undefined}
            >
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-16"
                  aria-invalid={Boolean(errors.password)}
                  {...register("password")}
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-[13px] font-semibold text-primary"
                >
                  {showPassword ? t("login.hide") : t("login.show")}
                </button>
              </div>
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={login.isPending || isLocked}
            >
              {login.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("login.submit")}
            </Button>
          </form>
          <p className="mt-5 text-center text-[13px] text-muted-foreground">{t("login.forgot")}</p>
        </div>
      </section>
    </main>
  );
}
