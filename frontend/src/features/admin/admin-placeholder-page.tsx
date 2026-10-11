// Placeholder for the admin dashboard (/admin). The real dashboard is designed and built in M1.
import { useTranslation } from "react-i18next";
import { HealthStatus } from "../health/health-status";

export function AdminPlaceholderPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("app.name")}</h1>
        <p className="mt-2 text-slate-600">{t("admin.comingSoon")}</p>
        <div className="mt-6 border-t border-slate-100 pt-6">
          <HealthStatus />
        </div>
      </section>
    </main>
  );
}
