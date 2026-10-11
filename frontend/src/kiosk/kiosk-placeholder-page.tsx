// Placeholder for the gate kiosk screen (/kiosk). The camera and punch flow arrive in M2.
// Kiosk text stays at least 24 px so it can be read from a step away (NFR-06).
import { useTranslation } from "react-i18next";

export function KioskPlaceholderPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center">
      <h1 className="text-5xl font-semibold tracking-tight text-slate-900">{t("kiosk.title")}</h1>
      <p className="text-2xl text-slate-600">{t("kiosk.comingSoon")}</p>
    </main>
  );
}
