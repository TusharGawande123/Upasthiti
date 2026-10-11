// Shown for any address that does not match a route.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("common.notFound")}</h1>
      <Link to="/admin" className="text-slate-700 underline underline-offset-4">
        {t("common.backToAdmin")}
      </Link>
    </main>
  );
}
